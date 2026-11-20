// 独立版入口：不经过 DeepSeek Harness，直接把工作台挂到页面上。
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Desk } from './index.jsx'

createRoot(document.getElementById('root')).render(<Desk standalone />)
