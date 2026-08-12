;(function(){
  function createButton(){
    const btn = document.createElement('div')
    btn.id = 'xb-relay-helper-btn'
    Object.assign(btn.style, {position:'fixed', right:'16px', bottom:'16px', zIndex:2147483647})

    const main = document.createElement('button')
    main.textContent = '快速添加中转'
    Object.assign(main.style, {padding:'10px 12px', background:'#0ea5e9', color:'#fff', border:'none', borderRadius:'8px', cursor:'pointer', boxShadow:'0 6px 18px rgba(0,0,0,0.12)'})
    btn.appendChild(main)

    const menu = document.createElement('div')
    Object.assign(menu.style, {marginTop:'8px', display:'flex', flexDirection:'column'})
    const tplBtn = document.createElement('button')
    tplBtn.textContent = '协议画廊'
    Object.assign(tplBtn.style, {padding:'8px 10px', marginBottom:'6px'})
    const addBtn = document.createElement('button')
    addBtn.textContent = '粘贴创建中转'
    Object.assign(addBtn.style, {padding:'8px 10px', marginBottom:'6px'})
    const testBtn = document.createElement('button')
    testBtn.textContent = '连通性测试'
    Object.assign(testBtn.style, {padding:'8px 10px'})
    menu.appendChild(tplBtn)
    menu.appendChild(addBtn)
    menu.appendChild(testBtn)
    btn.appendChild(menu)
    document.body.appendChild(btn)
    main.addEventListener('click', onClick)
    tplBtn.addEventListener('click', onTemplates)
    addBtn.addEventListener('click', onClick)
    testBtn.addEventListener('click', onTestRelay)
  }

  function onClick(){
    const input = prompt('粘贴分享链接（支持 vless/vmess/trojan/ss/socks/http），将生成可复制的 custom_outbounds JSON：')
    if(!input) return
    try{
      // call backend generate-relay if available
      const base = detectAdminBase()
      generateRelayBackend(base, input.trim()).then(res => {
        if(res && res.data){
          const payload = res.data
          showResult(JSON.stringify(payload, null, 2))
          copyToClipboard(JSON.stringify(payload))
          alert('已生成并复制到剪贴板，粘贴到面板的“自定义 Outbounds / Custom Routes”字段')
        } else {
          const out = parseShareLink(input.trim())
          showResult(JSON.stringify(out, null, 2))
          copyToClipboard(JSON.stringify(out))
          alert('已生成并复制到剪贴板，粘贴到面板的“自定义 Outbounds (JSON)”字段')
        }
      }).catch(err=>{
        // fallback to client parse
        const out = parseShareLink(input.trim())
        showResult(JSON.stringify(out, null, 2))
        copyToClipboard(JSON.stringify(out))
        alert('已生成并复制到剪贴板，粘贴到面板的“自定义 Outbounds (JSON)”字段')
      })
    }catch(err){
      alert('解析失败: '+err.message)
    }
  }

  function onTemplates(){
    const base = detectAdminBase()
    fetchTemplatesBackend(base).then(res=>{
      if(!res || !res.data){ alert('获取模板失败'); return }
      const templates = res.data.templates || []
      showTemplates(templates)
    }).catch(err=>{ alert('获取模板失败: '+err) })
  }

  function detectAdminBase(){
    // Try to detect admin prefix from current pathname
    const parts = window.location.pathname.split('/').filter(Boolean)
    if(parts.length>0){
      return '/' + parts[0]
    }
    return ''
  }

  function fetchTemplatesBackend(base){
    const url = (base||'') + '/server/manage/template/generate-templates'
    return fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({})}).then(r=>r.json())
  }

  function generateRelayBackend(base, shareLink){
    const url = (base||'') + '/server/manage/template/generate-relay'
    const body = {share_link: shareLink, inbound_tag: 'vless-in'}
    return fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)}).then(r=>r.json())
  }

  function testRelayBackend(base, shareLink){
    const url = (base||'') + '/server/manage/template/test-relay'
    const body = {share_link: shareLink}
    return fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)}).then(r=>r.json())
  }

  function onTestRelay(){
    const input = prompt('粘贴分享链接进行连通性测试：')
    if(!input) return
    const base = detectAdminBase()
    testRelayBackend(base, input.trim()).then(res => {
      if(res && res.data){
        showResult(JSON.stringify(res.data, null, 2))
      } else {
        showResult(JSON.stringify(res, null, 2))
      }
    }).catch(err=>{ alert('连通性测试失败: '+err) })
  }

  function showTemplates(templates){
    const wrap = document.createElement('div')
    Object.assign(wrap.style, {position:'fixed', left:'50%', top:'50%', transform:'translate(-50%,-50%)', zIndex:2147483647, background:'#fff', border:'1px solid #e5e7eb', borderRadius:'8px', padding:'12px', width:'720px', maxHeight:'70vh', overflow:'auto', boxShadow:'0 8px 32px rgba(0,0,0,0.12)'})
    templates.forEach(tpl=>{
      const card = document.createElement('div')
      card.style.borderBottom = '1px solid #eee'
      card.style.padding = '8px'
      const title = document.createElement('div')
      title.textContent = tpl.name || tpl.protocol
      title.style.fontWeight='600'
      const notes = document.createElement('div')
      notes.textContent = tpl.notes || ''
      notes.style.fontSize='12px'
      notes.style.color='#666'
      const pre = document.createElement('pre')
      pre.textContent = JSON.stringify(tpl.protocol_settings||{}, null, 2)
      pre.style.background='#f7f7f7'
      pre.style.padding='8px'
      pre.style.borderRadius='6px'
      const copy = document.createElement('button')
      copy.textContent = '复制设置'
      copy.style.marginRight='8px'
      copy.onclick = ()=>{ copyToClipboard(JSON.stringify(tpl.protocol_settings||{})); alert('已复制设置 JSON') }
      const open = document.createElement('button')
      open.textContent = '打开节点创建页'
      open.onclick = ()=>{ window.open((detectAdminBase()||'') + '/server/manage') }
      card.appendChild(title)
      card.appendChild(notes)
      card.appendChild(pre)
      card.appendChild(copy)
      card.appendChild(open)
      wrap.appendChild(card)
    })
    const close = document.createElement('button')
    close.textContent = '关闭'
    close.style.marginTop='8px'
    close.onclick = ()=>{ document.body.removeChild(wrap) }
    wrap.appendChild(close)
    document.body.appendChild(wrap)
  }

  function showResult(text){
    const wrap = document.createElement('div')
    Object.assign(wrap.style, {
      position:'fixed', left:'50%', top:'50%', transform:'translate(-50%,-50%)', zIndex:2147483647,
      background:'#fff', border:'1px solid #e5e7eb', borderRadius:'8px', padding:'12px', width:'640px', maxHeight:'60vh', overflow:'auto', boxShadow:'0 8px 32px rgba(0,0,0,0.12)'
    })
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.width = '100%'
    ta.style.height = '320px'
    wrap.appendChild(ta)
    const btns = document.createElement('div')
    btns.style.marginTop = '8px'
    const copy = document.createElement('button')
    copy.textContent = '复制'
    Object.assign(copy.style,{marginRight:'8px',padding:'6px 10px'})
    copy.onclick = ()=>{ copyToClipboard(ta.value).then(()=>alert('已复制')) }
    const close = document.createElement('button')
    close.textContent = '关闭'
    Object.assign(close.style,{padding:'6px 10px'})
    close.onclick = ()=>{ document.body.removeChild(wrap) }
    btns.appendChild(copy)
    btns.appendChild(close)
    wrap.appendChild(btns)
    document.body.appendChild(wrap)
    ta.select()
  }

  function copyToClipboard(text){
    if(navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text)
    }
    return new Promise((res, rej)=>{
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      try{ document.execCommand('copy'); document.body.removeChild(ta); res() }catch(e){ document.body.removeChild(ta); rej(e) }
    })
  }

  function parseShareLink(input){
    const lower = input.toLowerCase()
    if(lower.startsWith('vmess://')){
      const raw = input.slice(8)
      const decoded = tryBase64Decode(raw)
      const obj = JSON.parse(decoded)
      const address = obj.add || obj.address
      const port = parseInt(obj.port||obj.port||0)
      const id = obj.id || obj.uuid || obj.uid
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
    if(lower.startsWith('ss://') || lower.startsWith('shadowsocks://')){
      let raw = input.replace(/^ss:|^shadowsocks:/i,'')
      raw = raw.replace(/^\/\//,'')
      // try method:pass@host:port or base64 payload
      if(raw.includes('@')){
        const [up,hostpart] = raw.split('@')
        const [method,password] = up.split(':')
        const [host,port] = hostpart.split(':')
        return {protocol:'shadowsocks', tag:'relay-'+Date.now(), settings:{servers:[{address:host,port:parseInt(port),method,password}]}}
      }
      // base64 case
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

  function tryBase64Decode(s){
    try{
      // normalize padding
      let t = s.replace(/[-_]/g,'+')
      while(t.length%4) t += '='
      return atob(t)
    }catch(e){
      try{ return atob(s) }catch(err){ return null }
    }
  }

  // delayed init to ensure page DOM exists
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', createButton)
  else createButton()
})();
