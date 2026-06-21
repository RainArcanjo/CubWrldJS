import React from 'react';
import { CharacterViewer3D } from './CharacterViewer3D';
import { i18n } from './i18n';

const RACES = ['human', 'elf', 'dwarf', 'orc', 'goblin', 'lizard', 'undead', 'frogman'];

export function CharacterCreator({ config, onChange }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#f0f0f0',
      overflowY: 'auto'
    }}>
      
      {/* Viewer 3D com Zoom */}
      <div style={{ height: '250px', position: 'relative', display: 'flex', flexShrink: 0, borderBottom: '1px solid #ccc' }}>
        <CharacterViewer3D config={config} />
      </div>

      {/* Controles 7.css */}
      <div style={{
        padding: '15px',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <fieldset style={{ marginBottom: 15 }}>
          <legend>{i18n.raceAndGender}</legend>
          <div className="field-row" style={{ marginBottom: 8 }}>
            <label style={{ width: '80px' }}>{i18n.race}:</label>
            <select value={config.race} onChange={e => onChange({...config, race: e.target.value, face: 1, hair: 1})}>
              {RACES.map(r => <option key={r} value={r}>{i18n.races[r] || r}</option>)}
            </select>
          </div>

          <div className="field-row">
            <label style={{ width: '80px' }}>{i18n.gender}:</label>
            <select value={config.gender} onChange={e => onChange({...config, gender: e.target.value})}>
              <option value="m">{i18n.male}</option>
              <option value="f">{i18n.female}</option>
            </select>
          </div>
        </fieldset>

        <fieldset style={{ marginBottom: 15 }}>
          <legend>{i18n.appearance}</legend>
          <div className="field-row" style={{ marginBottom: 8, display: 'flex', alignItems: 'center' }}>
            <label style={{ width: '80px' }}>{i18n.face} ({config.face}):</label>
            <input type="range" min="1" max="6" value={config.face} onChange={e => onChange({...config, face: parseInt(e.target.value)})} style={{flex: 1}}/>
          </div>

          <div className="field-row" style={{ marginBottom: 8, display: 'flex', alignItems: 'center' }}>
            <label style={{ width: '80px' }}>{i18n.hair}</label>
            <input type="range" min="1" max="15" value={config.hair} onChange={e => onChange({...config, hair: parseInt(e.target.value)})} style={{flex: 1}}/>
          </div>

          <div className="field-row" style={{ display: 'flex', alignItems: 'center' }}>
            <label style={{ width: '80px' }}>{i18n.hairColor}</label>
            <input type="color" value={config.hairColor} onChange={e => onChange({...config, hairColor: e.target.value})} style={{ width: '100%', height: '24px' }}/>
          </div>
        </fieldset>
      </div>
      
    </div>
  );
}
