import { StrictMode, Fragment } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import TodoApp from './views'
import './events'
import './subs'
import './storage'
import { dispatch, enableTracing, enableTracePrint } from '@lib/index'
import { enableMapSet } from 'immer'

enableMapSet()
enableTracing()
enableTracePrint()


dispatch(['init-app']);

const useStrictMode = false
const Wrapper = useStrictMode ? StrictMode : Fragment;

createRoot(document.getElementById('root')!).render(
  <Wrapper>
    <TodoApp />
  </Wrapper>
)
