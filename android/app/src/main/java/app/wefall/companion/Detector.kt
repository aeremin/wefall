package app.wefall.companion

import java.io.File

enum class DeviceKind(val id: String, val label: String, val page: String) {
    /** Jump files go to the import page, which adds them to the logbook. */
    PROTRACK("protrack", "ProTrack", "/import"),

    /** Sessions go to the FlySight page's Tracks tab, which attaches them to logbook jumps. */
    FLYSIGHT2("flysight2", "FlySight 2", "/flysight"),
}

/** Tells a ProTrack from a FlySight 2 by the files on the drive. */
object Detector {
    /** The FlySight 2 firmware keeps its state (firmware version, device id) here. */
    private const val FLYSIGHT_STATE_FILE = "flysight.txt"

    /** How deep below the root to look for ProTrack jump files. */
    private const val MAX_DEPTH = 2

    /** ProTrack's 2 MB of flash holds a few hundred jumps; stop looking on drives with far more files. */
    private const val MAX_CANDIDATES = 2000
    private const val MAX_JUMP_FILE_BYTES = 1024 * 1024
    private const val HEADER_BYTES = 4096

    fun isFlySight2(files: DeviceFiles) =
        files.list("/").any { !it.isDirectory && it.name.equals(FLYSIGHT_STATE_FILE, ignoreCase = true) }

    /** Paths of the ProTrack jump files on the drive: .txt files whose first line (after comments) is "JIB". */
    fun proTrackJumpFiles(files: DeviceFiles): List<String> {
        val found = mutableListOf<String>()
        var checked = 0
        fun visit(dir: String, depth: Int) {
            for (entry in files.list(dir).sortedBy { it.name }) {
                val path = "${dir.trimEnd('/')}/${entry.name}"
                if (entry.isDirectory) {
                    if (depth < MAX_DEPTH && !entry.name.startsWith(".")) visit(path, depth + 1)
                } else if (entry.name.endsWith(".txt", ignoreCase = true) && entry.size <= MAX_JUMP_FILE_BYTES) {
                    if (++checked > MAX_CANDIDATES) return
                    if (isProTrackJump(files, path)) found += path
                }
            }
        }
        visit("/", 0)
        return found
    }

    /** Mirrors isProTrackFile in src/lib/protrack.ts. */
    private fun isProTrackJump(files: DeviceFiles, path: String): Boolean {
        val header = files.open(path).stream.use { it.readNBytes(HEADER_BYTES) }
        return String(header, Charsets.ISO_8859_1)
            .lineSequence()
            .map { it.trim() }
            .firstOrNull { it.isNotEmpty() && !it.startsWith("#") } == "JIB"
    }

    /** Copies the jump files into `dest` (emptied first), named as on the device. Returns how many were copied. */
    fun copyJumpFiles(files: DeviceFiles, paths: List<String>, dest: File): Int {
        dest.deleteRecursively()
        dest.mkdirs()
        val used = mutableSetOf<String>()
        for (path in paths) {
            // Files in different folders may share a name; keep the folder in that case.
            var name = path.substringAfterLast('/')
            if (!used.add(name.lowercase())) {
                name = path.trimStart('/').replace('/', '_')
                used.add(name.lowercase())
            }
            files.open(path).stream.use { input -> File(dest, name).outputStream().use { input.copyTo(it) } }
        }
        return paths.size
    }
}
