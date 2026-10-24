package app.wefall.companion

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.storage.StorageManager
import android.os.storage.StorageVolume
import android.provider.DocumentsContract
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.browser.customtabs.CustomTabsIntent
import java.io.File
import java.util.concurrent.Executors

/**
 * Opens when a ProTrack or FlySight 2 is plugged in (or from the launcher), waits for Android to mount
 * it as a USB drive, reads it through the Storage Access Framework (asking for access to each drive
 * once), and opens the WeFall page that offers its data: the import page for ProTrack jumps, the
 * FlySight page's Tracks tab for FlySight sessions.
 */
class MainActivity : Activity() {
    private lateinit var title: TextView
    private lateinit var message: TextView
    private lateinit var progress: ProgressBar
    private lateinit var action: Button
    private lateinit var details: TextView

    private val worker = Executors.newSingleThreadExecutor()

    /** Bumped for each new search, so results of an earlier one are dropped. */
    @Volatile
    private var generation = 0

    /** The drive the user is being asked to grant access to. */
    private var pendingVolume: StorageVolume? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        title = findViewById(R.id.title)
        message = findViewById(R.id.message)
        progress = findViewById(R.id.progress)
        action = findViewById(R.id.action)
        details = findViewById(R.id.details)
        // Content is drawn behind the system bars; keep it clear of them.
        val content = findViewById<View>(R.id.content)
        content.setOnApplyWindowInsetsListener { view, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Coming back from the notification shouldn't interrupt a share in progress.
        if (intent.action == UsbManager.ACTION_USB_DEVICE_ATTACHED || LocalServer.share == null) handle(intent)
    }

    override fun onDestroy() {
        worker.shutdownNow()
        super.onDestroy()
    }

    private fun handle(intent: Intent) {
        val attached = intent.action == UsbManager.ACTION_USB_DEVICE_ATTACHED
        val device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        details.text = device?.let(::describe) ?: ""
        val current = LocalServer.share
        if (!attached && current != null) return showShared(current)
        // Android mounts a drive a few seconds after it's plugged in.
        search(if (attached) MOUNT_TIMEOUT_MS else 0L)
    }

    private fun describe(device: UsbDevice): String {
        val ids = "%04x:%04x".format(device.vendorId, device.productId)
        return listOfNotNull("USB device $ids", device.productName, device.manufacturerName).joinToString(" · ")
    }

    // UI states

    private fun show(title: String, message: String, busy: Boolean = false, actionLabel: String? = null, onAction: (() -> Unit)? = null) {
        this.title.text = title
        this.message.text = message
        progress.visibility = if (busy) View.VISIBLE else View.GONE
        action.visibility = if (actionLabel != null) View.VISIBLE else View.GONE
        action.text = actionLabel
        action.setOnClickListener { onAction?.invoke() }
    }

    private fun ui(gen: Int, block: () -> Unit) = runOnUiThread { if (gen == generation) block() }

    private fun showShared(share: LocalServer.Share) {
        val note = when (share.kind) {
            DeviceKind.PROTRACK -> "The jumps are copied to this phone, so you can unplug the ProTrack."
            DeviceKind.FLYSIGHT2 -> "Keep the FlySight plugged in until WeFall has attached its tracks."
        }
        show(
            "${share.name} is ready",
            "WeFall opened in your browser with the device's data. $note",
            actionLabel = "Open WeFall again",
        ) { openPage(share) }
    }

    // Finding the drive

    private fun search(timeoutMs: Long) {
        val gen = ++generation
        show("Looking for the device…", "Waiting for Android to open it as a USB drive.", busy = true)
        worker.execute { findDevice(gen, timeoutMs) }
    }

    private fun mountedRemovableVolumes(): List<StorageVolume> =
        getSystemService(StorageManager::class.java).storageVolumes.filter {
            it.isRemovable && it.uuid != null && it.state == Environment.MEDIA_MOUNTED
        }

    private fun treeUri(volume: StorageVolume): Uri =
        DocumentsContract.buildTreeDocumentUri(EXTERNAL_STORAGE_AUTHORITY, "${volume.uuid}:")

    private fun canRead(volume: StorageVolume) =
        contentResolver.persistedUriPermissions.any { it.uri == treeUri(volume) && it.isReadPermission }

    private fun findDevice(gen: Int, timeoutMs: Long) {
        val deadline = System.currentTimeMillis() + timeoutMs
        /** Drives already read that turned out to be something else (e.g. an SD card). */
        val checked = mutableSetOf<String>()
        while (gen == generation) {
            val volumes = mountedRemovableVolumes()
            for (volume in volumes.filter { canRead(it) && it.uuid !in checked }) {
                checked += volume.uuid!!
                try {
                    if (readDevice(gen, volume)) return
                } catch (e: Exception) {
                    Log.w(TAG, "Reading ${volume.uuid} failed", e)
                    return ui(gen) {
                        show("Couldn't read the device", e.message ?: e.toString(), actionLabel = "Try again") { search(MOUNT_TIMEOUT_MS) }
                    }
                }
            }
            // Ask for drives not granted yet, USB drives before SD cards.
            val ungranted = volumes.filter { !canRead(it) }
                .sortedByDescending { it.getDescription(this).contains("USB", ignoreCase = true) }
            if (ungranted.isNotEmpty()) return ui(gen) { askForAccess(ungranted.first()) }
            if (System.currentTimeMillis() >= deadline) break
            try {
                Thread.sleep(POLL_MS)
            } catch (e: InterruptedException) {
                return // The activity is closing.
            }
        }
        ui(gen) {
            if (checked.isNotEmpty()) {
                show(
                    "Not a ProTrack or FlySight 2",
                    "The USB drive doesn't have ProTrack jump files or FlySight 2 sessions.",
                    actionLabel = "Try again",
                ) { search(MOUNT_TIMEOUT_MS) }
            } else {
                show(
                    "Plug in your ProTrack or FlySight 2",
                    "Connect it to this phone with a USB cable (and an OTG adapter if needed). WeFall opens by " +
                        "itself; when Android asks, let it open WeFall for this device every time.\n\n" +
                        "If nothing happens, the phone may not support USB drives, or it needs USB storage " +
                        "(OTG) turned on in its settings.",
                    actionLabel = "Look again",
                ) { search(MOUNT_TIMEOUT_MS) }
            }
        }
    }

    private fun askForAccess(volume: StorageVolume) {
        pendingVolume = volume
        show(
            "Allow access to ${volume.getDescription(this)}",
            "The first time you connect a device, Android asks which drive WeFall may read. Choose the " +
                "drive itself (not a folder on it), then tap \"Use this folder\" and \"Allow\".",
            actionLabel = "Choose drive",
        ) {
            startActivityForResult(volume.createOpenDocumentTreeIntent(), REQUEST_ACCESS)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val volume = pendingVolume ?: return
        if (requestCode != REQUEST_ACCESS) return
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null) return askForAccess(volume)
        if (DocumentsContract.getTreeDocumentId(uri) != "${volume.uuid}:") {
            show(
                "Choose the whole drive",
                "WeFall needs the top level of ${volume.getDescription(this)}, not a folder on it.",
                actionLabel = "Choose drive",
            ) { askForAccess(volume) }
            return
        }
        contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        pendingVolume = null
        search(0L)
    }

    // Reading the drive

    /** Reads the drive and starts sharing it if it's a ProTrack or FlySight 2; returns false otherwise. */
    private fun readDevice(gen: Int, volume: StorageVolume): Boolean {
        ui(gen) { show("Reading ${volume.getDescription(this)}…", "", busy = true) }
        val files = SafFiles(this, treeUri(volume))
        if (Detector.isFlySight2(files)) {
            share(gen, DeviceKind.FLYSIGHT2, files)
            return true
        }
        val jumps = Detector.proTrackJumpFiles(files)
        if (jumps.isEmpty()) return false
        ui(gen) { show("Copying ${jumps.size} ProTrack jumps…", "", busy = true) }
        val copy = File(filesDir, "protrack")
        Detector.copyJumpFiles(files, jumps, copy)
        share(gen, DeviceKind.PROTRACK, LocalFiles(copy))
        return true
    }

    private fun share(gen: Int, kind: DeviceKind, files: DeviceFiles) {
        if (gen != generation) return
        val share = LocalServer.start(kind, kind.label, files)
        ui(gen) {
            ShareService.start(this)
            requestNotificationPermission()
            showShared(share)
            openPage(share)
        }
    }

    /** Without it the sharing notification (and its Stop button) stays hidden; sharing works either way. */
    private fun requestNotificationPermission() {
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        }
    }

    private fun openPage(share: LocalServer.Share) {
        val port = LocalServer.port ?: return search(0L)
        // In the fragment, so the token never reaches the web server's logs.
        val url = Uri.parse("${BuildConfig.WEFALL_URL}${share.kind.page}#app=$port:${share.token}")
        if (BuildConfig.DEBUG) Log.d(TAG, "Opening $url")
        try {
            CustomTabsIntent.Builder().build().launchUrl(this, url)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Install a web browser to open WeFall.", Toast.LENGTH_LONG).show()
        }
    }

    companion object {
        private const val TAG = "WeFall"
        private const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"
        private const val MOUNT_TIMEOUT_MS = 30_000L
        private const val POLL_MS = 500L
        private const val REQUEST_ACCESS = 1
        private const val REQUEST_NOTIFICATIONS = 2
    }
}
