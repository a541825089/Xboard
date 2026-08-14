RelayHelper React 组件集成说明

1) 目的
- 将 `xb-relay-helper-v2.js` 的功能正式集成到 admin 前端源码（React），提供“协议画廊”、单条中转和批量 TXT 中转功能，调用后端 API：
  - POST `/server/manage/template/generate-templates`
  - POST `/server/manage/template/generate-relay`

2) 使用方法
- 把 `resources/js/components/RelayHelper.jsx` 拷贝到 admin 前端源码的组件目录（例如 `src/components/`）。
- 在全局布局或管理页入口组件中引入并渲染：

```jsx
import RelayHelper from '@/components/RelayHelper'

function App(){
  return (<>
    <YourApp />
    <RelayHelper base="" />
  </>)
}
```

3) 可配置项
- `base`：可选，admin 路径前缀（例如 `/admin`），默认自动使用当前路径的第一级作为前缀。

4) 注意事项
- 组件会优先调用后端 `generate-relay`，如失败则回退到客户端解析逻辑。
- “连通性测试”未实现；若需要可以实现后端探测接口并在组件中调用。

5) 测试
- 在本地构建 admin 前端后打开管理页面，点击右下角按钮测试粘贴分享链接与协议画廊功能。
