import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { Character } from './Character';

export function CharacterViewer3D({ config }) {
  const containerRef = useRef(null);
  const stateRef = useRef(null);

  // Initialize Scene
  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = null; // transparent background

    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
    // Position camera closer to character for a nice zoom
    camera.position.set(0, 10, 28);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    // Add canvas to DOM
    containerRef.current.appendChild(renderer.domElement);

    // Create the character instance
    const character = new Character();
    // Start with the provided config
    character.config = { ...character.config, ...config };
    character.load();

    // Center the character slightly lower so its feet touch the bottom and head is visible
    character.group.position.set(0, -5, 0);
    scene.add(character.group);

    // Keep camera focused on character center
    camera.lookAt(new THREE.Vector3(0, 5, 0));

    let rafId;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      
      // Slowly rotate the character to show all sides
      if (character.group) {
        character.group.rotation.y += 0.01;
      }
      
      // Update animations so they stand idle smoothly (walking with 0 speed)
      // Cube World chars just bob when walking, we can set speed to 0 so they just stand.
      character.updateAnimation(0, 0.016);

      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(containerRef.current);

    stateRef.current = { character, renderer, rafId, resizeObserver };

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []); // Run only once

  // Update character appearance when config changes
  useEffect(() => {
    if (stateRef.current?.character) {
      stateRef.current.character.setAppearance(config);
    }
  }, [config]);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        flex: 1,
        width: '100%', 
        height: '100%', 
        background: 'radial-gradient(circle, #e0e0e0 0%, #b0b0b0 100%)',
        overflow: 'hidden'
      }} 
    />
  );
}
