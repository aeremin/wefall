package app.wefall.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper

/**
 * Keeps the app running while the WeFall page reads the device through LocalServer: Android freezes
 * apps in the background, which would stop the server. Stops after a while without requests.
 */
class ShareService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val idleCheck = object : Runnable {
        override fun run() {
            if (LocalServer.share == null || System.currentTimeMillis() - LocalServer.lastRequestAt > IDLE_TIMEOUT_MS) {
                stopSelf()
            } else {
                handler.postDelayed(this, IDLE_CHECK_MS)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        val notification = notification(LocalServer.share?.name ?: getString(R.string.app_name))
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        handler.removeCallbacks(idleCheck)
        handler.postDelayed(idleCheck, IDLE_CHECK_MS)
        return START_NOT_STICKY
    }

    /** Android limits data sync services to 6 hours a day. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacks(idleCheck)
        LocalServer.stop()
        super.onDestroy()
    }

    private fun notification(deviceName: String): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Device sharing", NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, ShareService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Sharing $deviceName with WeFall")
            .setContentText("Stops after ${IDLE_TIMEOUT_MS / 60_000} minutes without use")
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Stop", stop).build())
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "sharing"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_STOP = "app.wefall.companion.STOP"
        private const val IDLE_TIMEOUT_MS = 15 * 60_000L
        private const val IDLE_CHECK_MS = 30_000L

        fun start(context: Context) {
            context.startForegroundService(Intent(context, ShareService::class.java))
        }
    }
}
