import { useState } from 'react'
import './App.css'
import WebRTCCall from './components/WebRTCCall'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <WebRTCCall />
    </>
  )
}

export default App
