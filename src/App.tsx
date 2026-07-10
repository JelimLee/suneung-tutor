import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AuthGate from './components/AuthGate'
import ProblemSelect from './pages/ProblemSelect'
import Solve from './pages/Solve'
import Chat from './pages/Chat'

export default function App() {
  return (
    <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ProblemSelect />} />
          <Route path="/solve/:problemId" element={<Solve />} />
          <Route path="/chat/:problemId" element={<Chat />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  )
}
