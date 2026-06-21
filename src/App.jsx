import React, { useState } from 'react';
import CubViewer from './CubViewer';
import WorldViewer from './WorldViewer';
import { CharacterCreator } from './CharacterCreator';
import { i18n } from './i18n';

function App() {
  const [isMinimized, setIsMinimized] = useState(false);
  const [viewMode, setViewMode] = useState('menu'); // 'menu', 'cub', 'world'

  const [charConfig, setCharConfig] = useState({
    race: 'human', gender: 'm', face: 1, hair: 1, hairColor: '#ffaa00'
  });

  // Controls whether the secondary character creator window is open
  const [isCreatorOpen, setIsCreatorOpen] = useState(false);

  const titleText = viewMode === 'menu' ? 'Cube World Tools - Menu' 
                  : viewMode === 'cub' ? 'Cub Viewer - 3D Visualizer' 
                  : 'World Generator Demo';

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px' }}>
      
      {/* Main App Window */}
      <div className="window glass" style={{ width: '900px', height: '650px', display: isMinimized ? 'none' : 'flex', flexDirection: 'column' }}>
        <div className="title-bar">
          <div className="title-bar-text">{titleText}</div>
          <div className="title-bar-controls">
            <button aria-label="Minimize" onClick={() => setIsMinimized(true)}></button>
            <button aria-label="Maximize"></button>
            <button aria-label="Close"></button>
          </div>
        </div>
        
        <div className="window-body" style={{ margin: 0, flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          
          {viewMode === 'menu' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '24px', background: '#e0e0e0' }}>
               <h1 style={{ fontFamily: 'Segoe UI, Tahoma, sans-serif', color: '#333', fontSize: '32px' }}>CWAlpha Tools</h1>
                <div style={{ display: 'flex', gap: '20px' }}>
                 <button 
                   style={{ padding: '20px 40px', fontSize: '18px', cursor: 'pointer' }}
                   onClick={() => setViewMode('world')}
                 >
                   {i18n.createWorld}
                 </button>
                 <button 
                   style={{ padding: '20px 40px', fontSize: '18px', cursor: 'pointer' }}
                   onClick={() => setViewMode('cub')}
                 >
                   {i18n.viewCub}
                 </button>
               </div>
            </div>
          )}

          {viewMode === 'cub' && (
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <CubViewer onBack={() => setViewMode('menu')} />
            </div>
          )}

          {viewMode === 'world' && (
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
              <button 
                onClick={() => setIsCreatorOpen(prev => !prev)} 
                style={{ position: 'absolute', top: 10, right: 10, zIndex: 100, padding: '4px 8px' }}
              >
                {isCreatorOpen ? i18n.closeCreator : i18n.openCreator}
              </button>
              <WorldViewer charConfig={charConfig} onBack={() => setViewMode('menu')} />
            </div>
          )}

        </div>
      </div>

      {/* Secondary Independent Window: Character Creator */}
      {viewMode === 'world' && isCreatorOpen && (
        <div className="window glass active" style={{ width: '380px', height: '650px', display: 'flex', flexDirection: 'column' }}>
          <div className="title-bar">
            <div className="title-bar-text">{i18n.characterCustomization}</div>
            <div className="title-bar-controls">
              <button aria-label="Close" onClick={() => setIsCreatorOpen(false)}></button>
            </div>
          </div>
          <div className="window-body" style={{ margin: 0, flex: 1, display: 'flex', overflow: 'hidden' }}>
            <CharacterCreator 
              config={charConfig} 
              onChange={setCharConfig} 
            />
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
