package com.arya.omnix

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var pendingAudioRequest: PermissionRequest? = null

    private val audioPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val request = pendingAudioRequest
            pendingAudioRequest = null
            if (request == null) return@registerForActivityResult

            if (granted && request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            } else {
                request.deny()
            }
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        webView.setBackgroundColor(android.graphics.Color.rgb(9, 11, 16))
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val uri = request.url
                if (uri.scheme == "https" && uri.host == "aryaone4565.github.io") {
                    return false
                }
                if (uri.scheme == "https" || uri.scheme == "http") {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                    return true
                }
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val allowedOrigin = request.origin.host == "aryaone4565.github.io"
                    val audioOnly = request.resources.all {
                        it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
                    }
                    if (!allowedOrigin || !audioOnly) {
                        request.deny()
                        return@runOnUiThread
                    }

                    if (ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            Manifest.permission.RECORD_AUDIO
                        ) == PackageManager.PERMISSION_GRANTED
                    ) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    } else {
                        pendingAudioRequest?.deny()
                        pendingAudioRequest = request
                        audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    }
                }
            }
        }

        setContentView(webView)
        if (savedInstanceState == null) {
            webView.loadUrl("https://aryaone4565.github.io/omnix-ai/")
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("Deprecated in Android API; retained for WebView back navigation")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.destroy()
        }
        super.onDestroy()
    }
}
