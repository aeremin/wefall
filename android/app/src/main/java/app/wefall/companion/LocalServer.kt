package app.wefall.companion

import android.net.Uri
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.FileNotFoundException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * Serves the plugged-in device's files to the WeFall page over http://127.0.0.1, which Chrome lets
 * HTTPS pages fetch (after asking the user once per site for access to apps on this device).
 *
 * Every request needs the share's token, which only the page the app opened knows, and must come from
 * one of the WeFall origins. Endpoints:
 * - GET /info: {"kind": "protrack" | "flysight2", "name": "..."}
 * - GET /list?path=/dir: [{"name", "size", "modified" (ms or null), "isDirectory"}]
 * - GET /file?path=/dir/file: the file's bytes
 */
object LocalServer {
    private const val TAG = "LocalServer"

    /** The WeFall site and the Vite dev server. */
    private val ALLOWED_ORIGINS = setOf(
        "https://wefall.web.app",
        "https://wefall.firebaseapp.com",
        "http://localhost:5173",
    )
    private const val MAX_HEADER_BYTES = 16 * 1024

    class Share(val kind: DeviceKind, val name: String, val files: DeviceFiles, val token: String)

    @Volatile
    var share: Share? = null
        private set

    /** When the page last asked for something, for ShareService's idle timeout. */
    @Volatile
    var lastRequestAt = 0L
        private set

    private var socket: ServerSocket? = null
    private val workers = Executors.newCachedThreadPool()

    val port: Int? get() = socket?.localPort

    /** Starts sharing `files` (replacing any earlier share) and returns the new share. */
    @Synchronized
    fun start(kind: DeviceKind, name: String, files: DeviceFiles): Share {
        val token = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        val next = Share(kind, name, files, token)
        share = next
        lastRequestAt = System.currentTimeMillis()
        if (socket == null) {
            val server = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
            socket = server
            Thread({ accept(server) }, "LocalServer").start()
        }
        return next
    }

    @Synchronized
    fun stop() {
        share = null
        socket?.close()
        socket = null
    }

    private fun accept(server: ServerSocket) {
        try {
            while (true) {
                val client = server.accept()
                workers.execute {
                    client.use {
                        try {
                            handle(it)
                        } catch (e: Exception) {
                            Log.w(TAG, "Connection failed", e)
                        }
                    }
                }
            }
        } catch (e: SocketException) {
            // Closed by stop().
        }
    }

    private class Request(val method: String, val uri: Uri, val headers: Map<String, String>)

    private fun readRequest(input: InputStream): Request? {
        val head = ByteArrayOutputStream()
        var matched = 0
        val end = "\r\n\r\n"
        while (matched < end.length) {
            val b = input.read()
            if (b < 0 || head.size() >= MAX_HEADER_BYTES) return null
            head.write(b)
            matched = if (b.toChar() == end[matched]) matched + 1 else if (b.toChar() == end[0]) 1 else 0
        }
        val lines = head.toString("ISO-8859-1").split("\r\n")
        val parts = lines[0].split(' ')
        if (parts.size < 2) return null
        val headers = lines.drop(1).mapNotNull { line ->
            val colon = line.indexOf(':')
            if (colon <= 0) null else line.substring(0, colon).trim().lowercase() to line.substring(colon + 1).trim()
        }.toMap()
        return Request(parts[0], Uri.parse("http://127.0.0.1${parts[1]}"), headers)
    }

    private fun handle(client: Socket) {
        val output = client.getOutputStream()
        val request = readRequest(BufferedInputStream(client.getInputStream())) ?: return
        val origin = request.headers["origin"]
        if (origin != null && origin !in ALLOWED_ORIGINS) {
            return respond(output, 403, null, json(JSONObject().put("error", "Origin not allowed")))
        }
        if (request.method == "OPTIONS") return respond(output, 204, origin, null)
        if (request.method != "GET") return respond(output, 405, origin, json(JSONObject().put("error", "Method not allowed")))

        val current = share
        if (current == null || request.uri.getQueryParameter("token") != current.token) {
            return respond(output, 403, origin, json(JSONObject().put("error", "This link has expired. Plug the device in again.")))
        }
        lastRequestAt = System.currentTimeMillis()
        val path = request.uri.getQueryParameter("path") ?: "/"
        try {
            when (request.uri.path) {
                "/info" -> respond(output, 200, origin, json(JSONObject().put("kind", current.kind.id).put("name", current.name)))
                "/list" -> {
                    val list = JSONArray()
                    for (e in current.files.list(path)) {
                        list.put(
                            JSONObject()
                                .put("name", e.name)
                                .put("size", e.size)
                                .put("modified", e.modified ?: JSONObject.NULL)
                                .put("isDirectory", e.isDirectory),
                        )
                    }
                    respond(output, 200, origin, json(list))
                }
                "/file" -> {
                    val file = current.files.open(path)
                    file.stream.use { respond(output, 200, origin, Body("application/octet-stream", file.size, it)) }
                }
                else -> respond(output, 404, origin, json(JSONObject().put("error", "Not found")))
            }
        } catch (e: FileNotFoundException) {
            respond(output, 404, origin, json(JSONObject().put("error", e.message ?: "Not found")))
        } catch (e: SocketException) {
            // The page went away mid-response.
        } catch (e: Exception) {
            Log.w(TAG, "Request for ${request.uri} failed", e)
            respond(output, 500, origin, json(JSONObject().put("error", e.message ?: e.toString())))
        }
    }

    private class Body(val contentType: String, val length: Long, val stream: InputStream)

    private fun json(value: Any): Body {
        val bytes = value.toString().toByteArray()
        return Body("application/json", bytes.size.toLong(), bytes.inputStream())
    }

    private fun respond(output: OutputStream, status: Int, origin: String?, body: Body?) {
        val reason = mapOf(200 to "OK", 204 to "No Content", 403 to "Forbidden", 404 to "Not Found", 405 to "Method Not Allowed")
        val head = StringBuilder("HTTP/1.1 $status ${reason[status] ?: "Error"}\r\n")
        head.append("Connection: close\r\nCache-Control: no-store\r\n")
        if (origin != null) {
            head.append("Access-Control-Allow-Origin: $origin\r\nVary: Origin\r\n")
            head.append("Access-Control-Allow-Methods: GET\r\nAccess-Control-Allow-Headers: *\r\n")
            // Private Network Access preflights, which older Chrome versions send.
            head.append("Access-Control-Allow-Private-Network: true\r\n")
        }
        head.append("Content-Length: ${body?.length ?: 0}\r\n")
        if (body != null) head.append("Content-Type: ${body.contentType}\r\n")
        head.append("\r\n")
        output.write(head.toString().toByteArray(Charsets.ISO_8859_1))
        body?.stream?.copyTo(output, 64 * 1024)
        output.flush()
    }
}
