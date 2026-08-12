import React, {useState} from 'react'

function tryBase64Decode(s){
  try{ let t = s.replace(/[-_]/g,'+'); while(t.length%4) t += '='; return atob(t) }catch(e){ try{ return atob(s) }catch(err){ return null }}
}

function parseShareLink(input){
  const lower = input.toLowerCase()
  if(lower.startsWith('vmess://')){
    const raw = input.slice(8)
    const decoded = tryBase64Decode(raw)
    const obj = JSON.parse(decoded)
    const address = obj.add || obj.address
    const port = parseInt(obj.port||0)
    const id = obj.id || obj.uuid
    return {protocol:'vmess', tag: 'relay-'+Date.now(), settings:{vnext:[{address,port,users:[{id}] }]}}
  }
  if(lower.startsWith('vless://')){
    const u = new URL(input)
    const id = u.username
    const [host,port] = u.host.split(':')
    return {protocol:'vless', tag:'relay-'+Date.now(), settings:{vnext:[{address:host,port:parseInt(port),users:[{id}]}]}}
  }
  if(lower.startsWith('trojan://')){
    const u = new URL(input)
    const pw = u.password
    const [host,port] = u.host.split(':')
    return {protocol:'trojan', tag:'relay-'+Date.now(), settings:{servers:[{address:host,port:parseInt(port),password:pw}]}}
  }
  if(lower.startsWith('ss://')||lower.startsWith('shadowsocks://')){
    let raw = input.replace(/^ss:|^shadowsocks:/i,'').replace(/^\/\//,'')
    if(raw.includes('@')){
      const [up,hostpart] = raw.split('@')
      const [method,password] = up.split(':')
      const [host,port] = hostpart.split(':')
      return {protocol:'shadowsocks', tag:'relay-'+Date.now(), settings:{servers:[{address:host,port:parseInt(port),method,password}]}}
    }
    const decoded = tryBase64Decode(raw)
    if(decoded){
      const idx = decoded.indexOf('@')
      if(idx>0){
        const up = decoded.slice(0,idx)
        const hostpart = decoded.slice(idx+1)
        const [method,password] = up.split(':')
        const [host,port] = hostpart.split(':')
        return {protocol:'shadowsocks', tag:'relay-'+Date.now(), settings:{servers:[{address:host,port:parseInt(port),method,password}]}}
      }
    }
    throw new Error('无法解析 shadowsocks 链接')
  }
  if(lower.startsWith('socks://')||lower.startsWith('http://')){
    const u = new URL(input)
    const user = u.username
    const pass = u.password
    const [host,port] = u.host.split(':')
    const server = {address:host,port:parseInt(port)}
    if(user||pass) server.users=[{user,pass}]
    return {protocol: u.protocol.replace(':',''), tag:'relay-'+Date.now(), settings:{servers:[server]}}
  }
  throw new Error('不支持的分享链接协议')
}

export default function RelayHelper({base=''}){
  const [modal, setModal] = useState(null)
  const [templates, setTemplates] = useState([])

  async function fetchTemplates(){
    const url = (base||'') + '/server/manage/template/generate-templates'
    const res = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({})})
    return res.json()
  }

  async function generateRelay(share){
    const url = (base||'') + '/server/manage/template/generate-relay'
    const body = {share_link: share, inbound_tag: 'vless-in'}
    const res = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)})
    return res.json()
  }

  async function onPasteCreate(){
    const input = window.prompt('粘贴分享链接：')
    if(!input) return
    try{
      const res = await generateRelay(input.trim())
      if(res && res.data){
        setModal({title:'生成结果（后端）', text: JSON.stringify(res.data, null, 2)})
        await navigator.clipboard.writeText(JSON.stringify(res.data))
        alert('已复制到剪贴板')
        return
      }
    }catch(e){ /* fallback */ }
    try{
      const out = parseShareLink(input.trim())
      setModal({title:'生成结果（客户端）', text: JSON.stringify(out, null, 2)})
      await navigator.clipboard.writeText(JSON.stringify(out))
      alert('已复制到剪贴板')
    }catch(err){ alert('解析失败: '+err.message) }
  }

  async function onOpenTemplates(){
    try{
      const r = await fetchTemplates()
      const list = (r && r.data && r.data.templates) || []
      setTemplates(list)
      setModal({title:'协议画廊'})
    }catch(e){ alert('获取模板失败') }
  }

  return (
    <div style={{position:'fixed',right:16,bottom:16,zIndex:2147483647}}>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        <button onClick={onPasteCreate} style={{padding:'10px 12px',background:'#0ea5e9',color:'#fff',border:'none',borderRadius:8}}>粘贴创建中转</button>
        <button onClick={onOpenTemplates} style={{padding:'8px 10px'}}>协议画廊</button>
      </div>

      {modal && (
        <div style={{position:'fixed',left:'50%',top:'50%',transform:'translate(-50%,-50%)',background:'#fff',border:'1px solid #e5e7eb',borderRadius:8,padding:12,width:720,maxHeight:'70vh',overflow:'auto',boxShadow:'0 8px 32px rgba(0,0,0,0.12)'}}>
          <div style={{fontWeight:600,marginBottom:8}}>{modal.title}</div>
          {modal.text && <pre style={{background:'#f7f7f7',padding:8,borderRadius:6,whiteSpace:'pre-wrap'}}>{modal.text}</pre>}
          {templates.length>0 && templates.map((tpl,i)=>(
            <div key={i} style={{borderBottom:'1px solid #eee',padding:8}}>
              <div style={{fontWeight:600}}>{tpl.name || tpl.protocol}</div>
              <div style={{fontSize:12,color:'#666'}}>{tpl.notes||''}</div>
              <pre style={{background:'#f7f7f7',padding:8,borderRadius:6,whiteSpace:'pre-wrap'}}>{JSON.stringify(tpl.protocol_settings||{}, null, 2)}</pre>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>{navigator.clipboard.writeText(JSON.stringify(tpl.protocol_settings||{})); alert('已复制')}}>复制设置</button>
                <button onClick={()=>window.open((base||'') + '/server/manage')}>打开节点创建页</button>
              </div>
            </div>
          ))}
          <div style={{marginTop:8,display:'flex',justifyContent:'flex-end',gap:8}}>
            <button onClick={()=>setModal(null)}>关闭</button>
          </div>
        </div>
      )}
    </div>
  )
}
