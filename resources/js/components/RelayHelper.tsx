import React, { useState } from 'react'

type RelayTemplate = {
  protocol?: string
  name?: string
  notes?: string
  protocol_settings?: Record<string, any>
}

type RelayHelperProps = {
  base?: string
}

function tryBase64Decode(value: string): string | null {
  try {
    let text = value.replace(/[-_]/g, '+')
    while (text.length % 4) {
      text += '='
    }
    return atob(text)
  } catch (_) {
    try {
      return atob(value)
    } catch (_) {
      return null
    }
  }
}

function parseShareLink(input: string) {
  const lower = input.trim().toLowerCase()

  if (lower.startsWith('vmess://')) {
    const raw = input.slice(8)
    const decoded = tryBase64Decode(raw)
    if (!decoded) throw new Error('无法解析 vmess 链接')
    const obj = JSON.parse(decoded)
    const address = obj.add || obj.address
    const port = Number(obj.port || 0)
    const id = obj.id || obj.uuid
    return { protocol: 'vmess', tag: `relay-${Date.now()}`, settings: { vnext: [{ address, port, users: [{ id }] }] } }
  }

  if (lower.startsWith('vless://')) {
    const u = new URL(input)
    const id = u.username
    const [host, port] = u.host.split(':')
    return { protocol: 'vless', tag: `relay-${Date.now()}`, settings: { vnext: [{ address: host, port: Number(port), users: [{ id }] }] } }
  }

  if (lower.startsWith('trojan://')) {
    const u = new URL(input)
    const pw = u.password
    const [host, port] = u.host.split(':')
    return { protocol: 'trojan', tag: `relay-${Date.now()}`, settings: { servers: [{ address: host, port: Number(port), password: pw }] } }
  }

  if (lower.startsWith('ss://') || lower.startsWith('shadowsocks://')) {
    let raw = input.replace(/^ss:|^shadowsocks:/i, '').replace(/^\/\//, '')
    if (raw.includes('@')) {
      const [up, hostpart] = raw.split('@')
      const [method, password] = up.split(':')
      const [host, port] = hostpart.split(':')
      return { protocol: 'shadowsocks', tag: `relay-${Date.now()}`, settings: { servers: [{ address: host, port: Number(port), method, password }] } }
    }
    const decoded = tryBase64Decode(raw)
    if (decoded) {
      const idx = decoded.indexOf('@')
      if (idx > 0) {
        const up = decoded.slice(0, idx)
        const hostpart = decoded.slice(idx + 1)
        const [method, password] = up.split(':')
        const [host, port] = hostpart.split(':')
        return { protocol: 'shadowsocks', tag: `relay-${Date.now()}`, settings: { servers: [{ address: host, port: Number(port), method, password }] } }
      }
    }
    throw new Error('无法解析 shadowsocks 链接')
  }

  if (lower.startsWith('socks://') || lower.startsWith('http://')) {
    const u = new URL(input)
    const user = u.username
    const pass = u.password
    const [host, port] = u.host.split(':')
    const server: Record<string, any> = { address: host, port: Number(port) }
    if (user || pass) server.users = [{ user, pass }]
    return { protocol: u.protocol.replace(':', ''), tag: `relay-${Date.now()}`, settings: { servers: [server] } }
  }

  throw new Error('不支持的分享链接协议')
}

function normalizeBasePath(base: string) {
  if (!base) return ''
  return base.startsWith('/') ? base : `/${base}`
}

export default function RelayHelper({ base = '' }: RelayHelperProps) {
  const [templates, setTemplates] = useState<RelayTemplate[]>([])
  const [modalText, setModalText] = useState<string | null>(null)
  const [modalTitle, setModalTitle] = useState<string | null>(null)

  async function fetchTemplates() {
    const url = `${normalizeBasePath(base)}/server/manage/template/generate-templates`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    return response.json()
  }

  async function generateRelay(shareLink: string) {
    const url = `${normalizeBasePath(base)}/server/manage/template/generate-relay`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share_link: shareLink, inbound_tag: 'vless-in' }),
    })
    return response.json()
  }

  async function handlePasteCreate() {
    const input = window.prompt('粘贴分享链接：')
    if (!input) return

    const trimmed = input.trim()
    try {
      const result = await generateRelay(trimmed)
      if (result?.data) {
        setModalTitle('生成结果（后端）')
        setModalText(JSON.stringify(result.data, null, 2))
        await navigator.clipboard.writeText(JSON.stringify(result.data))
        alert('已复制到剪贴板')
        return
      }
    } catch {
      // fallback to client-side parse
    }

    try {
      const fallback = parseShareLink(trimmed)
      setModalTitle('生成结果（客户端）')
      setModalText(JSON.stringify(fallback, null, 2))
      await navigator.clipboard.writeText(JSON.stringify(fallback))
      alert('已复制到剪贴板')
    } catch (err) {
      alert(`解析失败: ${(err as Error).message}`)
    }
  }

  async function handleOpenTemplates() {
    try {
      const result = await fetchTemplates()
      const templateList = result?.data?.templates || []
      setTemplates(templateList)
      setModalTitle('协议画廊')
      setModalText(null)
    } catch (err) {
      alert(`获取模板失败: ${(err as Error).message}`)
    }
  }

  async function handleTestRelay() {
    const input = window.prompt('粘贴分享链接进行连通性测试：')
    if (!input) return

    try {
      const response = await fetch(`${normalizeBasePath(base)}/server/manage/template/test-relay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share_link: input.trim() }),
      })
      const result = await response.json()
      if (result?.data) {
        setTemplates([])
        setModalTitle('连通性测试结果')
        setModalText(JSON.stringify(result.data, null, 2))
        return
      }
      setModalTitle('连通性测试结果')
      setModalText(JSON.stringify(result, null, 2))
    } catch (err) {
      alert(`连通性测试失败: ${(err as Error).message}`)
    }
  }

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 2147483647 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          type="button"
          onClick={handlePasteCreate}
          style={{ padding: '10px 12px', background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
        >
          粘贴创建中转
        </button>
        <button
          type="button"
          onClick={handleOpenTemplates}
          style={{ padding: '8px 10px', cursor: 'pointer' }}
        >
          协议画廊
        </button>
          <button
            type="button"
            onClick={handleTestRelay}
            style={{ padding: '8px 10px', cursor: 'pointer' }}
          >
            连通性测试
          </button>
            maxHeight: '70vh',
            overflow: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{modalTitle}</div>
          {modalText && (
            <pre style={{ background: '#f7f7f7', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {modalText}
            </pre>
          )}
          {templates.length > 0 && templates.map((tpl, index) => (
            <div key={index} style={{ borderBottom: '1px solid #eee', padding: 8 }}>
              <div style={{ fontWeight: 600 }}>{tpl.name || tpl.protocol}</div>
              {tpl.notes && <div style={{ fontSize: 12, color: '#666' }}>{tpl.notes}</div>}
              <pre style={{ background: '#f7f7f7', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {JSON.stringify(tpl.protocol_settings || {}, null, 2)}
              </pre>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(tpl.protocol_settings || {}))
                    alert('已复制')
                  }}
                >
                  复制设置
                </button>
                <button
                  type="button"
                  onClick={() => window.open(`${normalizeBasePath(base)}/server/manage`, '_blank')}
                >
                  打开节点创建页
                </button>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => { setModalTitle(null); setTemplates([]); setModalText(null) }}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
