<script setup lang="ts">
import { onMounted } from 'vue'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NNotificationProvider,
  NLoadingBarProvider,
} from 'naive-ui'
import { useWalletStore } from './stores/wallet'
import { useThemeStore } from './stores/theme'

const walletStore = useWalletStore()
const themeStore = useThemeStore()

const handleConnect = async () => {
  try {
    await walletStore.connect()
  } catch {
    // 错误由 walletStore 记录，根节点统一展示。
  }
}

const handleDisconnect = async () => {
  await walletStore.disconnect()
}

onMounted(() => {
  // 恢复已连接状态：等待钱包 provider 就绪 + reconnect 静默恢复（不弹窗）
  walletStore.restoreConnection()
})
</script>

<template>
  <NConfigProvider
    :theme="themeStore.naiveTheme"
    :theme-overrides="themeStore.naiveThemeOverrides"
  >
    <NLoadingBarProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <NMessageProvider>
            <div class="app-container">
              <!-- Header -->
              <header class="app-header">
                <div class="header-left">
                  <router-link to="/" class="logo">
                    <svg width="32" height="32" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="256" cy="256" r="256" fill="#EB1727"/>
                      <path fill="#fefefe" d="M202.4025 130.5h127.195q.2 75-.5 150-5 79.5-82.5 97.5-34.4 6.2-68-3-54.3-18.8-64.5-75.5a133 133 0 0 1-2.5-28h56q3.2 66.9 69 55.5 27-8 33.5-35.5.3-4.3 2-13 .7-49 .5-98a1260 1260 0 0 0-71-1M305.6 226l100 60-100"/>
                    </svg>
                    <span class="logo-text">Jscan <span class="beta-tag">V2 Beta</span></span>
                  </router-link>
                  <nav class="header-nav">
                    <router-link to="/tools" class="nav-link">工具集</router-link>
                  </nav>
                </div>

                <div class="header-right">
                  <!-- 主题切换 -->
                  <button
                    class="btn-theme"
                    :title="themeStore.isDark ? '切换到浅色' : '切换到暗色'"
                    @click="themeStore.toggle()"
                    :aria-label="themeStore.isDark ? '切换到浅色模式' : '切换到暗色模式'"
                  >
                    <svg v-if="themeStore.isDark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="5"/>
                      <line x1="12" y1="1" x2="12" y2="3"/>
                      <line x1="12" y1="21" x2="12" y2="23"/>
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                      <line x1="1" y1="12" x2="3" y2="12"/>
                      <line x1="21" y1="12" x2="23" y2="12"/>
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                    </svg>
                    <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                    </svg>
                  </button>

                  <!-- 钱包连接 -->
                  <div v-if="walletStore.isConnected" class="wallet-info">
                    <div class="wallet-details">
                      <router-link :to="`/address/${walletStore.address}`" class="wallet-address-link">
                        {{ walletStore.formatAddress(walletStore.address) }}
                      </router-link>
                      <span class="wallet-balance">
                        {{ walletStore.formatBalance(walletStore.balance) }} J
                      </span>
                    </div>
                    <button @click="handleDisconnect" class="btn-disconnect">断开</button>
                  </div>
                  <button
                    v-else
                    @click="handleConnect"
                    :disabled="walletStore.isConnecting"
                    class="btn-connect"
                  >
                    {{ walletStore.isConnecting ? '连接中...' : '🔐 连接钱包' }}
                  </button>
                </div>
              </header>
              <div v-if="walletStore.connectionError" class="connection-error" role="alert">
                {{ walletStore.connectionError }}
                <button type="button" aria-label="关闭连接提示" @click="walletStore.connectionError = ''">关闭</button>
              </div>

              <!-- Main Content -->
              <main class="app-main">
                <router-view />
              </main>
            </div>
          </NMessageProvider>
        </NNotificationProvider>
      </NDialogProvider>
    </NLoadingBarProvider>
  </NConfigProvider>
</template>

<style scoped>
.connection-error { margin:12px 24px; padding:12px; border:1px solid var(--jv-error); border-radius:var(--jv-radius-md); color:var(--jv-error); background:var(--jv-error-bg); }
.connection-error button { color:inherit; background:transparent; border:0; cursor:pointer; margin-left:16px; }
</style>

<style scoped>
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--jv-bg-page);
  color: var(--jv-text-primary);
  transition: background var(--jv-duration-normal) var(--jv-ease),
              color var(--jv-duration-normal) var(--jv-ease);
}

.app-header {
  background: var(--jv-bg-surface);
  border-bottom: 1px solid var(--jv-border);
  padding: 14px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: var(--jv-shadow-sm);
  position: sticky;
  top: 0;
  z-index: var(--jv-z-header);
  transition: background var(--jv-duration-normal) var(--jv-ease),
              border-color var(--jv-duration-normal) var(--jv-ease);
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
}

.header-nav {
  display: flex;
  align-items: center;
  margin-left: 20px;
  padding-left: 20px;
  border-left: 1px solid var(--jv-border);
}

.nav-link {
  font-size: 0.92rem;
  font-weight: 500;
  color: var(--jv-text-secondary);
  text-decoration: none;
  padding: 6px 12px;
  border-radius: var(--jv-radius-md);
  transition: color var(--jv-duration-fast) var(--jv-ease),
              background var(--jv-duration-fast) var(--jv-ease);
}

.nav-link:hover {
  color: var(--jv-brand);
  background: var(--jv-brand-subtle);
}

.nav-link.router-link-active {
  color: var(--jv-brand);
  font-weight: 600;
}

.logo svg { flex-shrink: 0; }

.logo-text {
  color: var(--jv-text-primary);
  font-size: 1.25rem;
  font-weight: 700;
  transition: color var(--jv-duration-normal) var(--jv-ease);
}

.beta-tag {
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--jv-info-bg);
  color: var(--jv-info);
  padding: 2px 8px;
  border-radius: var(--jv-radius-full);
  margin-left: 6px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 主题切换按钮 */
.btn-theme {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--jv-border);
  border-radius: var(--jv-radius-md);
  background: transparent;
  color: var(--jv-text-secondary);
  cursor: pointer;
  transition: all var(--jv-duration-fast) var(--jv-ease);
}

.btn-theme:hover {
  background: var(--jv-bg-subtle);
  color: var(--jv-text-primary);
  border-color: var(--jv-brand);
}

.btn-theme:focus-visible {
  outline: 2px solid var(--jv-brand);
  outline-offset: 2px;
}

/* 钱包 */
.wallet-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.wallet-details {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.wallet-address-link {
  font-family: var(--n-font-family-mono, 'Courier New', monospace);
  color: var(--jv-text-primary);
  font-weight: 600;
  font-size: 0.85rem;
  text-decoration: none;
  transition: color var(--jv-duration-fast);
}

.wallet-address-link:hover { color: var(--jv-link); }

.wallet-balance {
  color: var(--jv-text-muted);
  font-size: 0.78rem;
  font-weight: 500;
}

.btn-connect {
  background: var(--jv-brand);
  color: #fff;
  border: none;
  padding: 0 18px;
  height: 36px;
  border-radius: var(--jv-radius-md);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.875rem;
  transition: background var(--jv-duration-fast) var(--jv-ease),
              transform var(--jv-duration-fast);
}

.btn-connect:hover:not(:disabled) {
  background: var(--jv-brand-hover);
  transform: translateY(-1px);
}

.btn-connect:active:not(:disabled) {
  background: var(--jv-brand-pressed);
  transform: translateY(0);
}

.btn-connect:disabled { opacity: 0.55; cursor: not-allowed; }

.btn-connect:focus-visible {
  outline: 2px solid var(--jv-brand);
  outline-offset: 2px;
}

.btn-disconnect {
  background: var(--jv-error-bg);
  color: var(--jv-error);
  border: 1px solid var(--jv-error);
  padding: 0 12px;
  height: 32px;
  border-radius: var(--jv-radius-sm);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.85rem;
  transition: background var(--jv-duration-fast);
}

.btn-disconnect:hover { filter: brightness(0.95); }

.app-main { flex: 1; }
</style>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--jv-bg-page);
  color: var(--jv-text-primary);
  transition: background 200ms ease, color 200ms ease;
}

#app { min-height: 100vh; }
</style>
