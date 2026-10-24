package app.wefall.companion

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.ConcurrentHashMap

/** One entry of a directory listing, shaped like the page's FlySightFile. */
data class Entry(val name: String, val size: Long, val modified: Long?, val isDirectory: Boolean)

class OpenedFile(val size: Long, val stream: InputStream)

/** Read-only files the page can browse. Paths start at the drive's root and use "/", e.g. "/26-10-22/10-15-30". */
interface DeviceFiles {
    /** Throws FileNotFoundException when there's no directory at `path`. */
    fun list(path: String): List<Entry>

    /** Throws FileNotFoundException when there's no file at `path`. */
    fun open(path: String): OpenedFile
}

private fun segments(path: String) = path.split('/').filter { it.isNotEmpty() }

/**
 * A USB drive mounted by Android, read through the Storage Access Framework tree the user granted.
 * Folder listings are cached, since every path is resolved from the root and the devices don't record
 * while they're plugged in as a drive.
 */
class SafFiles(context: Context, private val tree: Uri) : DeviceFiles {
    private val resolver = context.contentResolver
    private val listings = ConcurrentHashMap<String, List<Child>>()

    private class Child(val documentId: String, val entry: Entry)

    private fun children(documentId: String): List<Child> = listings.getOrPut(documentId) { query(documentId) }

    private fun query(documentId: String): List<Child> {
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId)
        val projection = arrayOf(
            Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_MIME_TYPE,
            Document.COLUMN_SIZE,
            Document.COLUMN_LAST_MODIFIED,
        )
        // A drive that was unplugged no longer answers queries.
        val cursor = resolver.query(uri, projection, null, null, null) ?: throw IOException(UNPLUGGED)
        return cursor.use { c ->
            buildList {
                while (c.moveToNext()) {
                    val modified = if (c.isNull(4)) 0L else c.getLong(4)
                    add(
                        Child(
                            c.getString(0),
                            Entry(
                                name = c.getString(1),
                                size = if (c.isNull(3)) 0L else c.getLong(3),
                                modified = modified.takeIf { it > 0 },
                                isDirectory = c.getString(2) == Document.MIME_TYPE_DIR,
                            ),
                        ),
                    )
                }
            }
        }
    }

    /** Walks `path` from the root, matching names case-insensitively like FAT does. */
    private fun resolve(path: String): Child? {
        var current = Child(DocumentsContract.getTreeDocumentId(tree), Entry("", 0, null, true))
        for (name in segments(path)) {
            if (!current.entry.isDirectory) return null
            val siblings = children(current.documentId)
            current = siblings.find { it.entry.name == name }
                ?: siblings.find { it.entry.name.equals(name, ignoreCase = true) }
                ?: return null
        }
        return current
    }

    override fun list(path: String): List<Entry> {
        val dir = resolve(path)?.takeIf { it.entry.isDirectory } ?: throw FileNotFoundException("$path not found")
        return children(dir.documentId).map { it.entry }
    }

    override fun open(path: String): OpenedFile {
        val file = resolve(path)?.takeIf { !it.entry.isDirectory } ?: throw FileNotFoundException("$path not found")
        val uri = DocumentsContract.buildDocumentUriUsingTree(tree, file.documentId)
        val stream = resolver.openInputStream(uri) ?: throw IOException(UNPLUGGED)
        return OpenedFile(file.entry.size, stream)
    }

    companion object {
        const val UNPLUGGED = "The device was unplugged."
    }
}

/** Files copied into the app's storage, so the page can read them after the device is unplugged. */
class LocalFiles(private val root: File) : DeviceFiles {
    private fun resolve(path: String): File {
        val file = File(root, segments(path).joinToString(File.separator))
        // Keep ".." from reaching outside the copy.
        if (!file.canonicalPath.startsWith(root.canonicalPath)) throw FileNotFoundException("$path not found")
        return file
    }

    override fun list(path: String): List<Entry> {
        val children = resolve(path).listFiles() ?: throw FileNotFoundException("$path not found")
        return children.map { Entry(it.name, if (it.isDirectory) 0 else it.length(), it.lastModified(), it.isDirectory) }
    }

    override fun open(path: String): OpenedFile {
        val file = resolve(path)
        if (!file.isFile) throw FileNotFoundException("$path not found")
        return OpenedFile(file.length(), file.inputStream())
    }
}
