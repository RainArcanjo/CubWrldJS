import * as THREE from 'three';

export const globalLightingUniforms = {
  uEnableStylized: { value: 1.0 },
  uAoMultiplier: { value: 1.0 },
  uShadowTint: { value: new THREE.Color(0x2a3b5c) },
  uMidMix: { value: 0.4 },
  uOccMix: { value: 0.8 },
  uMidDarken: { value: 0.65 },
  uOccDarken: { value: 0.3 },
  uCurve: { value: 1.0 },
  
  // Volumetric Height Fog Uniforms
  uFogColor: { value: new THREE.Color(0x7ec8e3) }, // Matches default sky horizon
  uFogDensity: { value: 0.005 },
  uFogHeightFalloff: { value: 0.015 },
  uFogBaseHeight: { value: 50.0 },
  
  // Sky Physics (THREE.Sky)
  uSkyTurbidity: { value: 10.0 },
  uSkyRayleigh: { value: 2.0 },
  uSkyMieCoefficient: { value: 0.005 },
  uSkyMieDirectionalG: { value: 0.8 }
};

export const vertexShader = `
  attribute float aoValue;
  varying vec3 vColor;
  varying float vAO;
  varying vec3 vWorldPosition;
  
  void main() {
    vColor = color;
    vAO = aoValue;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const fragmentShader = `
  varying vec3 vColor;
  varying float vAO;
  varying vec3 vWorldPosition;
  
  uniform float uEnableStylized;
  uniform float uAoMultiplier;
  uniform vec3 uShadowTint;
  uniform float uMidMix;
  uniform float uOccMix;
  uniform float uMidDarken;
  uniform float uOccDarken;
  uniform float uCurve;
  
  // Fog uniforms
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uFogHeightFalloff;
  uniform float uFogBaseHeight;
  
  void main() {
    // Apply contrast/multiplier curve
    float ao = clamp(vAO * uAoMultiplier, 0.0, 1.0);
    ao = pow(ao, uCurve);
    
    vec3 finalColor;
    
    // If stylized shading is off, fallback to basic multiplication
    if (uEnableStylized < 0.5) {
      finalColor = vColor * ao;
    } else {
      vec3 colorExposed = vColor;
      
      // Mid shadows (darkened base + tint)
      vec3 colorMid = mix(vColor * uMidDarken, vColor * uShadowTint, uMidMix);
      
      // Occluded shadows (very dark base + tint)
      vec3 colorOccluded = mix(vColor * uOccDarken, vColor * uShadowTint, uOccMix);
      
      if (ao >= 0.5) {
        // Interpolate between Mid and Exposed
        finalColor = mix(colorMid, colorExposed, (ao - 0.5) * 2.0);
      } else {
        // Interpolate between Occluded and Mid
        finalColor = mix(colorOccluded, colorMid, ao * 2.0);
      }
    }
    
    // --- HEIGHT VOLUMETRIC FOG ---
    float fogDist = length(cameraPosition - vWorldPosition);
    // Height factor: dense at base height, exponentially drops as you go up
    float heightFactor = exp(-uFogHeightFalloff * (vWorldPosition.y - uFogBaseHeight));
    
    // Combine distance and height
    float fogAmount = 1.0 - exp(-fogDist * uFogDensity * heightFactor);
    fogAmount = clamp(fogAmount, 0.0, 1.0);
    
    // Blend final color with atmospheric fog color
    gl_FragColor = vec4(mix(finalColor, uFogColor, fogAmount), 1.0);
  }
`;

export function createStylizedMaterial(wireframe = false) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    vertexColors: true,
    uniforms: globalLightingUniforms,
    wireframe: wireframe
  });
}
