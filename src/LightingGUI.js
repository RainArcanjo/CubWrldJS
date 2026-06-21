import GUI from 'lil-gui';
import { globalLightingUniforms } from './Shaders';

let guiInstance = null;
let mountCount = 0;

export const LightingGUI = {
  mount: () => {
    mountCount++;
    
    // Only create one instance
    if (guiInstance) return;

    guiInstance = new GUI({ title: 'Lighting / AO Tweaks' });
    
    // Helper object to proxy values to the uniforms
    const params = {
      enableStylized: globalLightingUniforms.uEnableStylized.value > 0.5,
      aoMultiplier: globalLightingUniforms.uAoMultiplier.value,
      shadowTint: '#' + globalLightingUniforms.uShadowTint.value.getHexString(),
      midMix: globalLightingUniforms.uMidMix.value,
      occMix: globalLightingUniforms.uOccMix.value,
      midDarken: globalLightingUniforms.uMidDarken.value,
      occDarken: globalLightingUniforms.uOccDarken.value,
      curve: globalLightingUniforms.uCurve.value,
      
      // Fog
      fogColor: '#' + globalLightingUniforms.uFogColor.value.getHexString(),
      fogDensity: globalLightingUniforms.uFogDensity.value,
      fogFalloff: globalLightingUniforms.uFogHeightFalloff.value,
      fogBaseHeight: globalLightingUniforms.uFogBaseHeight.value,
      
      // Sky
      skyTurbidity: globalLightingUniforms.uSkyTurbidity.value,
      skyRayleigh: globalLightingUniforms.uSkyRayleigh.value,
      skyMieCoefficient: globalLightingUniforms.uSkyMieCoefficient.value,
      skyMieDirectionalG: globalLightingUniforms.uSkyMieDirectionalG.value
    };

    // --- Toggles ---
    guiInstance.add(params, 'enableStylized').name('Stylized Shading').onChange(v => {
      globalLightingUniforms.uEnableStylized.value = v ? 1.0 : 0.0;
    });

    // --- Core AO ---
    const fCore = guiInstance.addFolder('Ambient Occlusion Base');
    fCore.add(params, 'aoMultiplier', 0.0, 3.0, 0.05).name('AO Multiplier').onChange(v => {
      globalLightingUniforms.uAoMultiplier.value = v;
    });
    fCore.add(params, 'curve', 0.1, 5.0, 0.1).name('Interpolation Curve').onChange(v => {
      globalLightingUniforms.uCurve.value = v;
    });

    // --- Shadow Colors ---
    const fShadows = guiInstance.addFolder('Shadow Stylization');
    fShadows.addColor(params, 'shadowTint').name('Shadow Tint').onChange(v => {
      globalLightingUniforms.uShadowTint.value.set(v);
    });
    
    fShadows.add(params, 'midDarken', 0.0, 1.0, 0.05).name('Mid Darken').onChange(v => {
      globalLightingUniforms.uMidDarken.value = v;
    });
    fShadows.add(params, 'occDarken', 0.0, 1.0, 0.05).name('Occ Darken').onChange(v => {
      globalLightingUniforms.uOccDarken.value = v;
    });
    
    fShadows.add(params, 'midMix', 0.0, 1.0, 0.05).name('Mid Tint Mix').onChange(v => {
      globalLightingUniforms.uMidMix.value = v;
    });
    fShadows.add(params, 'occMix', 0.0, 1.0, 0.05).name('Occ Tint Mix').onChange(v => {
      globalLightingUniforms.uOccMix.value = v;
    });

    // --- Volumetric Fog ---
    const fFog = guiInstance.addFolder('Atmosphere & Fog');
    fFog.addColor(params, 'fogColor').name('Fog Color').onChange(v => {
      globalLightingUniforms.uFogColor.value.set(v);
    });
    fFog.add(params, 'fogDensity', 0.0, 0.05, 0.001).name('Fog Density').onChange(v => {
      globalLightingUniforms.uFogDensity.value = v;
    });
    fFog.add(params, 'fogFalloff', 0.0, 0.1, 0.001).name('Height Falloff').onChange(v => {
      globalLightingUniforms.uFogHeightFalloff.value = v;
    });
    fFog.add(params, 'fogBaseHeight', -100.0, 200.0, 1.0).name('Base Height').onChange(v => {
      globalLightingUniforms.uFogBaseHeight.value = v;
    });

    // --- Advanced Sky Physics ---
    const fSky = guiInstance.addFolder('Advanced Sky Physics');
    fSky.add(params, 'skyTurbidity', 0.0, 20.0, 0.1).name('Turbidity (Dust)').onChange(v => {
      globalLightingUniforms.uSkyTurbidity.value = v;
    });
    fSky.add(params, 'skyRayleigh', 0.0, 4.0, 0.01).name('Rayleigh (Air)').onChange(v => {
      globalLightingUniforms.uSkyRayleigh.value = v;
    });
    fSky.add(params, 'skyMieCoefficient', 0.0, 0.1, 0.001).name('Mie Coeff (Haze)').onChange(v => {
      globalLightingUniforms.uSkyMieCoefficient.value = v;
    });
    fSky.add(params, 'skyMieDirectionalG', 0.0, 1.0, 0.01).name('Mie Dir G').onChange(v => {
      globalLightingUniforms.uSkyMieDirectionalG.value = v;
    });

    guiInstance.open();
  },
  
  unmount: () => {
    mountCount--;
    if (mountCount <= 0 && guiInstance) {
      guiInstance.destroy();
      guiInstance = null;
      mountCount = 0;
    }
  }
};
