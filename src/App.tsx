import { Toolbar } from './components/Toolbar'
import { FeatureTree } from './components/FeatureTree'
import { Viewport } from './components/Viewport'
import { PropertiesPanel } from './components/PropertiesPanel'

function App() {
  return (
    <>
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <FeatureTree />
        <Viewport />
        <PropertiesPanel />
      </div>
    </>
  )
}

export default App
