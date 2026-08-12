;(function () {
  const STATE = {
    currentTab: 'relay',
    nodes: [],
    selectedNodeIds: new Set(),
  }

  function detectAdminBase() {
    const path = window.location.pathname
      .split('/')
      .filter((p) => p !== '')
    if (path.length === 0) {
      return ''
    }
    return '/' + path[0]
  }

  function normalizeBase(base) {
    if (!base) return ''
    return base.startsWith('/') ? base : '/' + base
  }

  async function fetchJson(url, options = {}) {
    const resp = await fetch(url, Object.assign({ credentials: 'same-origin' }, options))
    return resp.json()
  }

  async function fetchTemplates(base) {
    const url = normalizeBase(base) + '/server/manage/template/generate-templates'
    return fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
  }

  async function generateRelay(base, shareLink) {
    const url = normalizeBase(base) + '/server/manage/template/generate-relay'
    return fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share_link: shareLink, inbound_tag: 'vless-in' }),
    })
  }

  async function testRelay(base, shareLink) {
    const url = normalizeBase(base) + '/server/manage/template/test-relay'
    return fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share_link: shareLink }),
    })
  }

  async function loadNodes(base) {
    const url = normalizeBase(base) + '/server/manage/getNodes'
    const res = await fetchJson(url)
    if (res && res.data) {
      STATE.nodes = res.data
    }
    return STATE.nodes
  }

  async function batchDelete(base, ids) {
    const url = normalizeBase(base) + '/server/manage/batchDelete'
    return fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
  }

  function isOffline(node) {
    return node.is_online === 0 || node.is_online === false || node.online === 0
  }

  function getSourceLabel(node) {
    if (node.machine_id && node.machine_id !== 0) {
      return '远程服务器'
    }
    if (node.type && node.type !== 'server') {
      return '节点模式'
    }
    return '独立部署'
  }

  function createButton() {
    const btn = document.createElement('div')
    btn.id = 'xb-relay-helper-btn'
    Object.assign(btn.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: 2147483647,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      fontFamily: 'sans-serif',
    })

    function makeAction(text, handler) {
      const button = document.createElement('button')
      button.textContent = text
      Object.assign(button.style, {
        padding: '10px 14px',
        background: '#0f172a',
        color: '#fff',
        border: 'none',
        borderRadius: '10px',
        cursor: 'pointer',
        fontSize: '13px',
      })
      button.addEventListener('click', handler)
      return button
    }

    btn.appendChild(makeAction('快速添加中转', openRelayPanel))
    btn.appendChild(makeAction('协议画廊', openTemplatePanel))
    btn.appendChild(makeAction('连通性测试', openTestPanel))
    btn.appendChild(makeAction('节点管理', openNodePanel))
    document.body.appendChild(btn)
  }

  function createOverlay() {
    const overlay = document.createElement('div')
    overlay.id = 'xb-relay-helper-overlay'
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: 2147483646,
      backgroundColor: 'rgba(15, 23, 42, 0.55)',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      overflowY: 'auto',
    })

    const panel = document.createElement('div')
    Object.assign(panel.style, {
      width: 'min(980px, calc(100% - 40px))',
      maxHeight: '90vh',
      background: '#ffffff',
      borderRadius: '20px',
      overflow: 'hidden',
      boxShadow: '0 24px 80px rgba(15, 23, 42, 0.25)',
      display: 'flex',
      flexDirection: 'column',
    })

    const header = document.createElement('div')
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '18px 22px',
      borderBottom: '1px solid #e2e8f0',
      background: '#f8fafc',
    })
    const title = document.createElement('div')
    title.textContent = 'XBoard 中转助手'
    Object.assign(title.style, { fontSize: '16px', fontWeight: '700' })
    const close = document.createElement('button')
    close.textContent = '关闭'
    Object.assign(close.style, {
      padding: '10px 14px',
      border: 'none',
      background: '#0f172a',
      color: '#fff',
      borderRadius: '10px',
      cursor: 'pointer',
    })
    close.addEventListener('click', () => { overlay.style.display = 'none' })
    header.appendChild(title)
    header.appendChild(close)

    const body = document.createElement('div')
    Object.assign(body.style, {
      display: 'flex',
      flex: '1',
      minHeight: '360px',
    })

    const sidebar = document.createElement('div')
    Object.assign(sidebar.style, {
      minWidth: '190px',
      borderRight: '1px solid #e2e8f0',
      padding: '18px',
      background: '#f8fafc',
    })

    const tabs = [
      { id: 'relay', label: '中转生成' },
      { id: 'template', label: '协议画廊' },
      { id: 'test', label: '连通测试' },
      { id: 'nodes', label: '节点管理' },
    ]

    tabs.forEach((tab) => {
      const item = document.createElement('button')
      item.textContent = tab.label
      item.dataset.tab = tab.id
      Object.assign(item.style, {
        width: '100%',
        textAlign: 'left',
        marginBottom: '10px',
        padding: '10px 14px',
        border: 'none',
        borderRadius: '12px',
        background: tab.id === STATE.currentTab ? '#0f172a' : '#ffffff',
        color: tab.id === STATE.currentTab ? '#ffffff' : '#0f172a',
        cursor: 'pointer',
      })
      item.addEventListener('click', () => switchTab(tab.id))
      sidebar.appendChild(item)
    })

    const content = document.createElement('div')
    content.id = 'xb-relay-helper-content'
    Object.assign(content.style, {
      flex: '1',
      padding: '20px',
      overflowY: 'auto',
      background: '#ffffff',
    })

    panel.appendChild(header)
    body.appendChild(sidebar)
    body.appendChild(content)
    panel.appendChild(body)
    overlay.appendChild(panel)
    document.body.appendChild(overlay)
    return overlay
  }

  function setActiveTabButton() {
    const sidebar = document.querySelector('#xb-relay-helper-overlay div > div:nth-child(2)')
    if (!sidebar) return
    sidebar.querySelectorAll('button').forEach((button) => {
      const tab = button.dataset.tab
      const active = tab === STATE.currentTab
      button.style.background = active ? '#0f172a' : '#ffffff'
      button.style.color = active ? '#ffffff' : '#0f172a'
    })
  }

  function switchTab(tabId) {
    STATE.currentTab = tabId
    setActiveTabButton()
    renderContent()
  }

  function createCard(title, description) {
    const card = document.createElement('div')
    Object.assign(card.style, {
      border: '1px solid #e2e8f0',
      borderRadius: '16px',
      padding: '18px',
      marginBottom: '16px',
      background: '#f8fafc',
    })
    const h3 = document.createElement('div')
    h3.textContent = title
    Object.assign(h3.style, { fontWeight: 700, marginBottom: '10px' })
    const desc = document.createElement('div')
    desc.textContent = description
    desc.style.color = '#475569'
    card.appendChild(h3)
    card.appendChild(desc)
    return card
  }

  function renderRelayTab(container) {
    container.appendChild(createCard('添加中转', '粘贴分享链接，自动识别协议并生成中转出站配置。'))
    const input = document.createElement('textarea')
    input.placeholder = '输入 share link，例如 vless://... 或 vmess://...'
    Object.assign(input.style, {
      width: '100%',
      minHeight: '120px',
      marginBottom: '12px',
      padding: '14px',
      borderRadius: '14px',
      border: '1px solid #cbd5e1',
      fontFamily: 'monospace',
      fontSize: '14px',
    })

    const button = document.createElement('button')
    button.textContent = '生成中转配置'
    Object.assign(button.style, {
      padding: '11px 16px',
      borderRadius: '12px',
      background: '#0ea5e9',
      color: '#ffffff',
      border: 'none',
      cursor: 'pointer',
      marginBottom: '12px',
    })

    const resultBox = document.createElement('pre')
    Object.assign(resultBox.style, {
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
      borderRadius: '14px',
      padding: '14px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: '250px',
      overflowY: 'auto',
      marginTop: '12px',
    })

    const actions = document.createElement('div')
    Object.assign(actions.style, { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' })

    const qrBtn = document.createElement('button')
    qrBtn.textContent = '生成二维码'
    Object.assign(qrBtn.style, {
      padding: '10px 14px',
      borderRadius: '12px',
      background: '#14b8a6',
      color: '#ffffff',
      border: 'none',
      cursor: 'pointer',
    })

    const testBtn = document.createElement('button')
    testBtn.textContent = '测试连通性'
    Object.assign(testBtn.style, {
      padding: '10px 14px',
      borderRadius: '12px',
      background: '#2563eb',
      color: '#ffffff',
      border: 'none',
      cursor: 'pointer',
    })

    const qrContainer = document.createElement('div')
    Object.assign(qrContainer.style, {
      marginTop: '16px',
      display: 'flex',
      justifyContent: 'flex-start',
      alignItems: 'center',
      gap: '14px',
      flexWrap: 'wrap',
    })

    button.addEventListener('click', async () => {
      const value = input.value.trim()
      if (!value) {
        alert('请先输入分享链接')
        return
      }
      resultBox.textContent = '正在生成配置…'
      const base = detectAdminBase()
      try {
        const res = await generateRelay(base, value)
        if (res && res.data) {
          resultBox.textContent = JSON.stringify(res.data, null, 2)
          await copyToClipboard(JSON.stringify(res.data, null, 2))
        } else {
          resultBox.textContent = JSON.stringify(res, null, 2)
        }
      } catch (err) {
        resultBox.textContent = '生成失败：' + ((err && err.message) || JSON.stringify(err))
      }
    })

    qrBtn.addEventListener('click', () => {
      const value = input.value.trim()
      if (!value) {
        alert('请先输入分享链接')
        return
      }
      qrContainer.innerHTML = ''
      const img = document.createElement('img')
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(value)
      img.alt = 'QR Code'
      Object.assign(img.style, { borderRadius: '16px', border: '1px solid #cbd5e1' })
      qrContainer.appendChild(img)
    })

    testBtn.addEventListener('click', async () => {
      const value = input.value.trim()
      if (!value) {
        alert('请先输入分享链接')
        return
      }
      resultBox.textContent = '正在测试连通性…'
      const base = detectAdminBase()
      try {
        const res = await testRelay(base, value)
        if (res && res.data) {
          resultBox.textContent = JSON.stringify(res.data, null, 2)
        } else {
          resultBox.textContent = JSON.stringify(res, null, 2)
        }
      } catch (err) {
        resultBox.textContent = '测试失败：' + ((err && err.message) || JSON.stringify(err))
      }
    })

    const hint = document.createElement('div')
    hint.textContent = '提示：结果会复制到剪贴板，可直接粘贴到自定义 Outbounds / Custom Routes。'
    hint.style.color = '#475569'
    hint.style.marginTop = '8px'

    container.appendChild(input)
    container.appendChild(button)
    actions.appendChild(qrBtn)
    actions.appendChild(testBtn)
    container.appendChild(actions)
    container.appendChild(hint)
    container.appendChild(resultBox)
    container.appendChild(qrContainer)
  }

  function renderTemplateTab(container) {
    container.appendChild(createCard('协议画廊', '快速浏览并复制预置中转模板。'))
    const button = document.createElement('button')
    button.textContent = '加载协议画廊'
    Object.assign(button.style, {
      padding: '11px 16px',
      borderRadius: '12px',
      background: '#0ea5e9',
      color: '#ffffff',
      border: 'none',
      cursor: 'pointer',
      marginBottom: '16px',
    })
    const list = document.createElement('div')
    Object.assign(list.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
      gap: '14px',
    })

    button.addEventListener('click', async () => {
      list.innerHTML = '正在加载…'
      const base = detectAdminBase()
      try {
        const res = await fetchTemplates(base)
        if (res && res.data && Array.isArray(res.data.templates)) {
          list.innerHTML = ''
          res.data.templates.forEach((tpl) => {
            const card = document.createElement('div')
            Object.assign(card.style, {
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              padding: '16px',
            })
            const title = document.createElement('div')
            title.textContent = tpl.name || tpl.protocol
            title.style.fontWeight = '700'
            title.style.marginBottom = '8px'
            const notes = document.createElement('div')
            notes.textContent = tpl.notes || ''
            notes.style.color = '#475569'
            notes.style.marginBottom = '12px'
            const pre = document.createElement('pre')
            pre.textContent = JSON.stringify(tpl.protocol_settings || {}, null, 2)
            Object.assign(pre.style, {
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '12px',
              maxHeight: '220px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            })
            const copy = document.createElement('button')
            copy.textContent = '复制设置'
            Object.assign(copy.style, {
              marginTop: '8px',
              padding: '10px 14px',
              borderRadius: '12px',
              background: '#14b8a6',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            })
            copy.addEventListener('click', async () => {
              await copyToClipboard(JSON.stringify(tpl.protocol_settings || {}, null, 2))
              alert('已复制设置')
            })
            card.appendChild(title)
            card.appendChild(notes)
            card.appendChild(pre)
            card.appendChild(copy)
            list.appendChild(card)
          })
        } else {
          list.textContent = '无可用模板'
        }
      } catch (err) {
        list.textContent = '加载失败：' + ((err && err.message) || JSON.stringify(err))
      }
    })

    container.appendChild(button)
    container.appendChild(list)
  }

  function renderTestTab(container) {
    container.appendChild(createCard('连通性测试', '直接检查分享链接目标地址是否可达。'))
    const input = document.createElement('textarea')
    input.placeholder = '输入要测试的分享链接'
    Object.assign(input.style, {
      width: '100%',
      minHeight: '120px',
      marginBottom: '12px',
      padding: '14px',
      borderRadius: '14px',
      border: '1px solid #cbd5e1',
      fontFamily: 'monospace',
      fontSize: '14px',
    })
    const button = document.createElement('button')
    button.textContent = '开始测试'
    Object.assign(button.style, {
      padding: '11px 16px',
      borderRadius: '12px',
      background: '#0ea5e9',
      color: '#ffffff',
      border: 'none',
      cursor: 'pointer',
      marginBottom: '12px',
    })
    const result = document.createElement('pre')
    Object.assign(result.style, {
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
      borderRadius: '14px',
      padding: '14px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: '280px',
      overflowY: 'auto',
    })
    button.addEventListener('click', async () => {
      const value = input.value.trim()
      if (!value) {
        alert('请先输入分享链接')
        return
      }
      result.textContent = '正在测试…'
      const base = detectAdminBase()
      try {
        const res = await testRelay(base, value)
        if (res && res.data) {
          result.textContent = JSON.stringify(res.data, null, 2)
        } else {
          result.textContent = JSON.stringify(res, null, 2)
        }
      } catch (err) {
        result.textContent = '测试失败：' + ((err && err.message) || JSON.stringify(err))
      }
    })
    container.appendChild(input)
    container.appendChild(button)
    container.appendChild(result)
  }

  function renderNodeTab(container) {
    container.appendChild(createCard('节点管理', '显示多服务器列表，离线服务器不可选，并支持批量删除。'))
    const loadBtn = document.createElement('button')
    loadBtn.textContent = '加载节点列表'
    Object.assign(loadBtn.style, {
      padding: '11px 16px',
      borderRadius: '12px',
      background: '#0ea5e9',
      color: '#ffffff',
      border: 'none',
      cursor: 'pointer',
      marginBottom: '12px',
    })
    const tableWrap = document.createElement('div')
    Object.assign(tableWrap.style, {
      maxHeight: '420px',
      overflowY: 'auto',
      border: '1px solid #cbd5e1',
      borderRadius: '16px',
    })
    const table = document.createElement('table')
    Object.assign(table.style, {
      width: '100%',
      borderCollapse: 'collapse',
      minWidth: '720px',
    })
    const thead = document.createElement('thead')
    thead.innerHTML = '<tr><th style="padding:12px;border-bottom:1px solid #e2e8f0;text-align:left;">选择</th><th style="padding:12px;border-bottom:1px solid #e2e8f0;text-align:left;">服务器</th><th style="padding:12px;border-bottom:1px solid #e2e8f0;text-align:left;">状态</th><th style="padding:12px;border-bottom:1px solid #e2e8f0;text-align:left;">来源</th><th style="padding:12px;border-bottom:1px solid #e2e8f0;text-align:left;">机器ID</th></tr>'
    const tbody = document.createElement('tbody')
    table.appendChild(thead)
    table.appendChild(tbody)
    tableWrap.appendChild(table)

    const actions = document.createElement('div')
    Object.assign(actions.style, { display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px' })
    const selectedLabel = document.createElement('div')
    selectedLabel.textContent = '已选 0 个节点'
    selectedLabel.style.alignSelf = 'center'
    const deleteBtn = document.createElement('button')
    deleteBtn.textContent = '批量删除选中节点'
    Object.assign(deleteBtn.style, {
      padding: '10px 14px',
      borderRadius: '12px',
      background: '#ef4444',
      color: '#ffffff',
      border: 'none',
      cursor: 'pointer',
    })
    deleteBtn.disabled = true
    deleteBtn.addEventListener('click', async () => {
      const ids = Array.from(STATE.selectedNodeIds)
      if (ids.length === 0) {
        alert('请先选择要删除的节点')
        return
      }
      if (!confirm(`确认删除 ${ids.length} 个节点？此操作不可恢复。`)) return
      const base = detectAdminBase()
      try {
        const res = await batchDelete(base, ids)
        if (res && res.data) {
          alert('批量删除成功')
          await loadNodes(base)
          renderNodeTable(tbody, selectedLabel, deleteBtn)
        } else {
          alert('批量删除失败')
        }
      } catch (err) {
        alert('批量删除失败：' + ((err && err.message) || JSON.stringify(err)))
      }
    })
    actions.appendChild(selectedLabel)
    actions.appendChild(deleteBtn)

    loadBtn.addEventListener('click', async () => {
      loadBtn.textContent = '加载中…'
      loadBtn.disabled = true
      const base = detectAdminBase()
      try {
        await loadNodes(base)
        renderNodeTable(tbody, selectedLabel, deleteBtn)
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:14px;color:#dc2626;">加载节点失败</td></tr>'
      } finally {
        loadBtn.textContent = '加载节点列表'
        loadBtn.disabled = false
      }
    })

    container.appendChild(loadBtn)
    container.appendChild(tableWrap)
    container.appendChild(actions)
  }

  function renderNodeTable(tbody, selectedLabel, deleteBtn) {
    tbody.innerHTML = ''
    STATE.selectedNodeIds.clear()
    if (!Array.isArray(STATE.nodes) || STATE.nodes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:14px;">暂无节点数据，请先加载。</td></tr>'
      selectedLabel.textContent = '已选 0 个节点'
      deleteBtn.disabled = true
      return
    }
    STATE.nodes.forEach((node) => {
      const offline = isOffline(node)
      const row = document.createElement('tr')
      row.style.background = offline ? '#f8fafc' : '#ffffff'
      row.style.color = offline ? '#94a3b8' : '#0f172a'
      row.innerHTML = `
        <td style="padding:12px;border-bottom:1px solid #e2e8f0;vertical-align:middle;"></td>
        <td style="padding:12px;border-bottom:1px solid #e2e8f0;vertical-align:middle;">${escapeHtml(node.name || node.title || node.server_name || 'Unnamed')}</td>
        <td style="padding:12px;border-bottom:1px solid #e2e8f0;vertical-align:middle;">${offline ? '离线' : '在线'}</td>
        <td style="padding:12px;border-bottom:1px solid #e2e8f0;vertical-align:middle;">${escapeHtml(getSourceLabel(node))}</td>
        <td style="padding:12px;border-bottom:1px solid #e2e8f0;vertical-align:middle;">${escapeHtml(node.machine_id ? node.machine_id.toString() : '无')}</td>
      `
      const checkboxTd = row.querySelector('td')
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.disabled = offline
      checkbox.style.transform = 'scale(1.2)'
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          STATE.selectedNodeIds.add(node.id)
        } else {
          STATE.selectedNodeIds.delete(node.id)
        }
        selectedLabel.textContent = `已选 ${STATE.selectedNodeIds.size} 个节点`
        deleteBtn.disabled = STATE.selectedNodeIds.size === 0
      })
      checkboxTd.appendChild(checkbox)
      tbody.appendChild(row)
    })
    selectedLabel.textContent = '已选 0 个节点'
    deleteBtn.disabled = true
  }

  function escapeHtml(value) {
    if (typeof value !== 'string') return String(value)
    return value.replace(/[&<>\"]/g, function (tag) {
      const chars = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
      }
      return chars[tag] || tag
    })
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        document.body.removeChild(ta)
        resolve()
      } catch (err) {
        document.body.removeChild(ta)
        reject(err)
      }
    })
  }

  function openRelayPanel() {
    showOverlay('relay')
  }

  function openTemplatePanel() {
    showOverlay('template')
  }

  function openTestPanel() {
    showOverlay('test')
  }

  function openNodePanel() {
    showOverlay('nodes')
  }

  function showOverlay(tab) {
    const overlay = document.getElementById('xb-relay-helper-overlay')
    if (!overlay) return
    overlay.style.display = 'flex'
    STATE.currentTab = tab
    setActiveTabButton()
    renderContent()
  }

  const overlay = createOverlay()
  createButton()
  document.addEventListener('DOMContentLoaded', () => {
    overlay.style.display = 'none'
  })

  function renderContent() {
    const content = document.getElementById('xb-relay-helper-content')
    if (!content) return
    content.innerHTML = ''
    if (STATE.currentTab === 'relay') {
      renderRelayTab(content)
    } else if (STATE.currentTab === 'template') {
      renderTemplateTab(content)
    } else if (STATE.currentTab === 'test') {
      renderTestTab(content)
    } else if (STATE.currentTab === 'nodes') {
      renderNodeTab(content)
    }
  }

  window.addEventListener('load', () => {
    const overlayEl = document.getElementById('xb-relay-helper-overlay')
    if (overlayEl) {
      overlayEl.style.display = 'none'
    }
  })
})()
