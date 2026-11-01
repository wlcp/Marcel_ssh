package com.wlcp.marcel

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.JavascriptInterface
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * 注入 WebView 的 Java/Kotlin 桥接对象（`window.AndroidBridge`）。
 *
 * 前端通过 `src/mobile/mobileBridge.ts` 封装后调用，所有方法都跑在 WebView 的 JS 线程，
 * 涉及 UI/权限的操作切回主线程执行。
 *
 * 设计权衡：用 `@JavascriptInterface` 而非 Tauri mobile plugin，避免独立 crate 工程量。
 * 安全注意：只暴露保活/通知相关方法，不暴露任意命令执行能力。
 */
class MobileBridge(private val activity: MainActivity) {

    // ---------- 前台保活服务 ----------

    /** 启动前台保活服务（幂等：已运行则更新通知）。 */
    @JavascriptInterface
    fun startForegroundService(title: String, body: String) {
        MarcelForegroundService.createChannels(activity)
        MarcelForegroundService.start(activity, title.ifBlank { "Marcel SSH" }, body.ifBlank { "运行中" })
    }

    /** 停止前台保活服务。 */
    @JavascriptInterface
    fun stopForegroundService() {
        MarcelForegroundService.stop(activity)
    }

    /** 更新常驻通知内容（服务必须已启动）。 */
    @JavascriptInterface
    fun updateForegroundNotification(title: String, body: String) {
        MarcelForegroundService.update(activity, title, body)
    }

    // ---------- 电池优化豁免（Doze 会掐断前台服务的网络） ----------

    /**
     * 本应用是否已被排除在电池优化之外（= 后台不被 Doze 限制网络）。
     * Android 6 以下没有 Doze，直接视为已豁免。
     */
    @JavascriptInterface
    fun isIgnoringBatteryOptimizations(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        return try {
            val pm = activity.getSystemService(android.content.Context.POWER_SERVICE)
                as android.os.PowerManager
            pm.isIgnoringBatteryOptimizations(activity.packageName)
        } catch (e: Exception) {
            android.util.Log.w("MarcelBridge", "isIgnoringBatteryOptimizations failed: $e")
            false
        }
    }

    /**
     * 弹出系统的「不受电池优化限制」授权框。
     * 部分 ROM 不支持 ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS，退回到电池优化列表页。
     * 返回 true = 弹出了直达授权框；false = 只打开了列表页（需要用户自己找本应用）。
     */
    @JavascriptInterface
    fun requestIgnoreBatteryOptimizations(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        return try {
            val intent = android.content.Intent(
                android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
            ).setData(android.net.Uri.parse("package:" + activity.packageName))
            activity.startActivity(intent)
            true
        } catch (e: Exception) {
            try {
                activity.startActivity(
                    android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                )
            } catch (_: Exception) {
                /* 极端受限的 ROM：连列表页都打不开，调用方按失败提示 */
            }
            false
        }
    }

    // ---------- Agent 事件通知 ----------

    /**
     * 发送 Agent 事件通知（审批/提问/任务完成/失败）。
     * 通过 startService Intent 派发给 MarcelForegroundService，由 Service 直接调 NotificationManager，
     * 不依赖 WebView JS 引擎活跃，前台后台均可靠。
     *
     * @param id 通知 ID（同类型事件用相同 ID，后到的覆盖先到的）
     */
    @JavascriptInterface
    fun sendAgentNotification(id: Int, title: String, body: String) {
        android.util.Log.i("MarcelBridge", "sendAgentNotification: id=$id title=$title")
        MarcelForegroundService.notifyAgentEvent(activity, id, title, body)
    }

    // ---------- 系统栏 insets ----------

    /**
     * 当前键盘 / 导航栏底部高度，格式 "ime,nav"（CSS 长度，如 "0px,48px"）。
     * 页面（重）载入后主动拉一次：原生推送的值可能落在被丢弃的旧文档上。
     */
    @JavascriptInterface
    fun getInsetBottoms(): String = "${activity.imeBottomCss},${activity.navBottomCss}"

    // ---------- 主题外框 ----------

    /**
     * 主题落定后同步外框：系统栏图标明暗 + 窗口 / WebView 底色（`#RRGGBB`），并记下供冷启动用。
     * 页面 `lib/uiTheme.ts` 每次应用主题都会推一次，所以浅色主题下状态栏图标不会再是白的。
     */
    @JavascriptInterface
    fun setSystemChrome(background: String, light: Boolean) {
        activity.runOnUiThread { activity.applySystemChrome(background, light) }
    }

    // ---------- 通知权限 ----------

    /** 检查 POST_NOTIFICATIONS 权限（API 33+ 需运行时权限，更低版本默认授予）。 */
    @JavascriptInterface
    fun isNotificationPermissionGranted(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    /**
     * 请求 POST_NOTIFICATIONS 权限。异步：弹出系统权限对话框。
     * 结果通过 `window.__marcelNotificationPermissionResult(granted: boolean)` 回调通知前端。
     */
    @JavascriptInterface
    fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            // 低版本无需请求，直接通知前端已授予
            activity.runOnUiThread {
                activity.notifyPermissionResult(true)
            }
            return
        }
        if (isNotificationPermissionGranted()) {
            activity.runOnUiThread { activity.notifyPermissionResult(true) }
            return
        }
        activity.runOnUiThread {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                MainActivity.REQUEST_NOTIFICATION_PERMISSION
            )
        }
    }
}
