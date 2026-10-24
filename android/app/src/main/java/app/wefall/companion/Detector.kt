package app.wefall.companion

import java.io.File
import java.io.IOException

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

    /** The ProTrack II keeps its status (device, serial number, firmware, battery) in SETUP/STATUS.TXT. */
    private const val PROTRACK_SETUP_DIR = "SETUP"
    private const val PROTRACK_STATUS_FILE = "STATUS.TXT"

    /** How deep below the root to look for ProTrack jump files. */
    private const val MAX_DEPTH = 2

    /** ProTrack's 2 MB of flash holds a few hundred jumps; stop looking on drives with far more files. */
    private const val MAX_CANDIDATES = 2000
    private const val MAX_JUMP_FILE_BYTES = 1024 * 1024

    fun isFlySight2(files: DeviceFiles) =
        files.list("/").any { !it.isDirectory && it.name.equals(FLYSIGHT_STATE_FILE, ignoreCase = true) }

    fun isProTrack(files: DeviceFiles): Boolean {
        val setup = files.list("/").find { it.isDirectory && it.name.equals(PROTRACK_SETUP_DIR, ignoreCase = true) }
            ?: return false
        return files.list("/${setup.name}").any { !it.isDirectory && it.name.equals(PROTRACK_STATUS_FILE, ignoreCase = true) }
    }

    /** .txt files that may be ProTrack jumps, by path (SETUP holds the device's own files). */
    private fun candidates(files: DeviceFiles): List<Pair<String, Entry>> {
        val found = mutableListOf<Pair<String, Entry>>()
        fun visit(dir: String, depth: Int) {
            for (entry in files.list(dir).sortedBy { it.name }) {
                if (found.size >= MAX_CANDIDATES) return
                val path = "${dir.trimEnd('/')}/${entry.name}"
                if (entry.isDirectory) {
                    val setup = depth == 0 && entry.name.equals(PROTRACK_SETUP_DIR, ignoreCase = true)
                    if (depth < MAX_DEPTH && !setup && !entry.name.startsWith(".")) visit(path, depth + 1)
                } else if (entry.name.endsWith(".txt", ignoreCase = true) && entry.size <= MAX_JUMP_FILE_BYTES) {
                    found += path to entry
                }
            }
        }
        visit("/", 0)
        return found
    }

    /** Mirrors isProTrackFile in src/lib/protrack.ts: the first line (after comments) is "JIB". */
    private fun isProTrackJump(contents: ByteArray) =
        String(contents, Charsets.ISO_8859_1)
            .lineSequence()
            .map { it.trim() }
            .firstOrNull { it.isNotEmpty() && !it.startsWith("#") } == "JIB"

    /**
     * Makes `dest` hold a copy of each jump file on a ProTrack, named as on the device. Each file is read
     * once, since telling a jump file apart takes its contents anyway; jumps copied on an earlier plug-in
     * (same name, size and time) aren't read again, as the ProTrack never changes a recorded jump. Copies of
     * jumps no longer on the device are removed. Reports progress as (files checked, files to check).
     */
    fun syncJumpFiles(files: DeviceFiles, dest: File, progress: (Int, Int) -> Unit) {
        val candidates = candidates(files)
        dest.mkdirs()
        val kept = mutableSetOf<String>()
        val used = mutableSetOf<String>()
        for ((i, candidate) in candidates.withIndex()) {
            progress(i, candidates.size)
            val (path, entry) = candidate
            // Files in different folders may share a name; keep the folder in that case.
            var name = entry.name
            if (!used.add(name.lowercase())) {
                name = path.trimStart('/').replace('/', '_')
                used.add(name.lowercase())
            }
            val target = File(dest, name)
            // FAT keeps times to 2 s, so compare whole seconds.
            val unchanged = target.isFile && target.length() == entry.size && entry.modified != null &&
                target.lastModified() / 1000 == entry.modified / 1000
            if (!unchanged) {
                val contents = files.open(path).stream.use { it.readBytes() }
                if (!isProTrackJump(contents)) continue
                val partial = File(dest, "$name.partial")
                partial.writeBytes(contents)
                entry.modified?.let { partial.setLastModified(it) }
                if (!partial.renameTo(target)) throw IOException("Couldn't save $name")
            }
            kept += name
        }
        progress(candidates.size, candidates.size)
        dest.listFiles()?.filter { it.name !in kept }?.forEach { it.delete() }
    }
}
