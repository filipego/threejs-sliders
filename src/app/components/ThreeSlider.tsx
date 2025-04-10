"use client";

import React, { useRef, useEffect, useCallback } from "react";
import * as THREE from "three";

const ThreeSlider: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const slidesRef = useRef<THREE.Mesh[]>([]);
  const animationFrameId = useRef<number | null>(null);

  // --- Settings and State Variables (using refs to avoid re-renders) ---
  const settings = useRef({
    wheelSensitivity: 0.01,
    touchSensitivity: 0.01,
    momentumMultiplier: 2,
    smoothing: 0.1,
    slideLerp: 0.075,
    distortionDecay: 0.95,
    maxDistortion: 2.5,
    distortionSensitivity: 0.15,
    distortionSmoothing: 0.075,
  }).current;

  const slideWidth = 3.0;
  const slideHeight = 1.5;
  const gap = 0.1;
  const slideCount = 10;
  const imagesCount = 5; // Number of actual image files (1.jpg to 5.jpg)
  const totalWidth = slideCount * (slideWidth + gap);
  const slideUnit = slideWidth + gap;

  const slides = useRef<THREE.Mesh[]>([]).current; // Keep track of slide meshes
  const currentPosition = useRef(0);
  const targetPosition = useRef(0);
  const isScrolling = useRef(false);
  const autoScrollSpeed = useRef(0);
  const lastTime = useRef(0);
  const touchStartX = useRef(0);
  const touchLastX = useRef(0);
  const prevPosition = useRef(0);

  const currentDistortionFactor = useRef(0);
  const targetDistortionFactor = useRef(0);
  const peakVelocity = useRef(0);
  const velocityHistory = useRef<number[]>(Array(5).fill(0)).current; // Store last 5 velocities

  // --- Helper Functions ---
  const correctImageColor = useCallback((texture: THREE.Texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  const createSlide = useCallback(
    (index: number) => {
      const geometry = new THREE.PlaneGeometry(slideWidth, slideHeight, 32, 16); // Segments for distortion

      // Fallback colors (optional but good for loading state)
      const colors = ["#FF5733", "#33FF57", "#3357FF", "#F3F33F", "#FF33F3"];
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colors[index % colors.length]),
        side: THREE.DoubleSide, // Render both sides
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.x = index * slideUnit;

      // Store original vertices and index in userData
      mesh.userData = {
        originalVertices: [
          ...(geometry.attributes.position.array as Float32Array),
        ],
        index: index,
        targetX: mesh.position.x, // Initialize targetX
        currentX: mesh.position.x, // Initialize currentX
      };

      // Load image texture
      const imageIndex = (index % imagesCount) + 1; // Loop through 1 to 5
      const imagePath = `/imgs/${imageIndex}.jpg`;
      new THREE.TextureLoader().load(
        imagePath,
        (texture) => {
          correctImageColor(texture);
          material.map = texture;
          material.color.set(0xffffff); // Set color to white to show texture fully
          material.needsUpdate = true;

          // Adjust mesh scale to fit image aspect ratio
          const imgAspect = texture.image.width / texture.image.height;
          const slideAspect = slideWidth / slideHeight;

          if (imgAspect > slideAspect) {
            mesh.scale.y = slideAspect / imgAspect;
          } else {
            mesh.scale.x = imgAspect / slideAspect;
          }
        },
        undefined, // onProgress callback (optional)
        (err) => {
          console.warn(`Couldn't load image ${imagePath}`, err);
        }
      );

      sceneRef.current?.add(mesh);
      slides.push(mesh);
    },
    [correctImageColor, imagesCount]
  ); // Include dependencies

  const updateCurve = useCallback(
    (mesh: THREE.Mesh, worldPositionX: number, distortionFactor: number) => {
      if (!mesh || !mesh.geometry || !mesh.userData.originalVertices) return;

      const distortionCenter = new THREE.Vector2(0, 0); // Center of the distortion effect
      const distortionRadius = 2.0; // How far the distortion effect spreads
      const maxCurvature = settings.maxDistortion * distortionFactor; // Use settings

      const positionAttribute = mesh.geometry.attributes.position;
      const originalVertices = mesh.userData.originalVertices as Float32Array;

      for (let i = 0; i < positionAttribute.count; i++) {
        const x = originalVertices[i * 3];
        const y = originalVertices[i * 3 + 1];
        // const z = originalVertices[i * 3 + 2]; // Original Z is 0 for PlaneGeometry

        const vertexWorldPosX = worldPositionX + x; // Calculate vertex world X position

        // Calculate distance from the center of the distortion field
        const distFromCenter = Math.sqrt(
          Math.pow(vertexWorldPosX - distortionCenter.x, 2) +
            Math.pow(y - distortionCenter.y, 2)
        );

        // Normalize distance and invert (closer = stronger effect)
        const distortionStrength = Math.max(
          0,
          1 - distFromCenter / distortionRadius
        );

        // Apply a curve (e.g., sine wave powered for sharper falloff)
        // Adjust the power (1.5 here) to control the curve shape
        const curveZ =
          Math.pow(Math.sin((distortionStrength * Math.PI) / 2), 1.5) *
          maxCurvature;

        // Update the Z position of the live vertex buffer
        positionAttribute.setZ(i, curveZ);
      }

      positionAttribute.needsUpdate = true; // Mark buffer for update
      mesh.geometry.computeVertexNormals(); // Recalculate normals if lighting is used
    },
    [settings.maxDistortion]
  ); // Include dependency

  // --- Animation Loop ---
  const animate = useCallback(
    (time: number) => {
      animationFrameId.current = requestAnimationFrame(animate);

      const deltaTime = lastTime.current
        ? (time - lastTime.current) / 1000
        : 0.016;
      lastTime.current = time;

      // Store previous position for velocity calculation
      prevPosition.current = currentPosition.current;

      // Apply momentum if scrolling
      if (isScrolling.current) {
        targetPosition.current += autoScrollSpeed.current;
        // Dampen the auto scroll speed over time
        const speedBasedDecay = 0.97 - Math.abs(autoScrollSpeed.current) * 0.5; // Faster decay at higher speed
        autoScrollSpeed.current *= Math.max(0.92, speedBasedDecay); // Apply decay, ensure minimum damping
        if (Math.abs(autoScrollSpeed.current) < 0.001) {
          autoScrollSpeed.current = 0; // Stop momentum if speed is negligible
        }
      }

      // Interpolate current position towards target (smoothing)
      currentPosition.current +=
        (targetPosition.current - currentPosition.current) * settings.smoothing;

      // Calculate current velocity
      const currentVelocity =
        Math.abs(currentPosition.current - prevPosition.current) / deltaTime;

      // Update velocity history
      velocityHistory.push(currentVelocity);
      velocityHistory.shift(); // Keep the history buffer size fixed

      // Calculate average velocity over the history
      const avgVelocity =
        velocityHistory.reduce((sum, val) => sum + val, 0) /
        velocityHistory.length;

      // Update peak velocity
      if (avgVelocity > peakVelocity.current) {
        peakVelocity.current = avgVelocity;
      }

      // Determine if decelerating
      const velocityRatio =
        peakVelocity.current > 0.001 ? avgVelocity / peakVelocity.current : 0;
      // Consider decelerating if velocity drops significantly AND peak was substantial
      const isDecelerating = velocityRatio < 0.7 && peakVelocity.current > 0.5;

      // Dampen peak velocity over time if not accelerating
      peakVelocity.current *= 0.99;

      // Calculate distortion based on movement
      const movementDistortion = Math.min(
        1.0,
        currentVelocity * settings.distortionSensitivity
      ); // Cap distortion

      // Update target distortion factor
      if (currentVelocity > 0.05) {
        // Only distort significantly if moving
        targetDistortionFactor.current = Math.max(
          targetDistortionFactor.current,
          movementDistortion
        );
      }

      // Decay target distortion factor over time, faster if decelerating or slow
      const decayRate =
        isDecelerating || avgVelocity < 0.2
          ? settings.distortionDecay // Use faster decay setting
          : settings.distortionDecay * 0.9; // Slower decay otherwise
      targetDistortionFactor.current *= decayRate;

      // Interpolate current distortion factor towards target
      currentDistortionFactor.current +=
        (targetDistortionFactor.current - currentDistortionFactor.current) *
        settings.distortionSmoothing;

      // --- Update Slide Positions and Apply Distortion ---
      slides.forEach((slide, i) => {
        // Calculate base position for this slide based on its index and current scroll
        let baseX = i * slideUnit - currentPosition.current;

        // Infinite loop wrapping logic
        baseX = ((baseX % totalWidth) + totalWidth) % totalWidth; // Ensure positive modulo
        if (baseX > totalWidth / 2) {
          baseX -= totalWidth; // Wrap around if more than halfway
        }

        // Interpolate slide's actual X position towards its target base position
        // Check if wrapping happened recently to avoid lerping across the wrap jump
        const isWrapping =
          Math.abs(baseX - slide.userData.targetX) > slideWidth * 2;
        if (isWrapping) {
          // If wrapping, jump directly to avoid visual glitch
          slide.userData.currentX = baseX;
        }
        slide.userData.targetX = baseX; // Update target for next frame
        slide.userData.currentX +=
          (slide.userData.targetX - slide.userData.currentX) *
          settings.slideLerp;

        // Optimization: Only update visible slides
        const wrapThreshold = totalWidth / 2 + slideWidth; // Area slightly larger than viewport
        if (Math.abs(slide.userData.currentX) < wrapThreshold * 1.5) {
          // Add some buffer
          slide.position.x = slide.userData.currentX;
          // Apply the curve distortion
          updateCurve(slide, slide.position.x, currentDistortionFactor.current);
        }
      });

      // Render the scene
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    },
    [
      settings,
      updateCurve,
      correctImageColor,
      createSlide,
      slides,
      totalWidth,
      slideUnit,
    ]
  ); // Add dependencies

  // --- Initialization and Event Listeners ---
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const currentWidth = window.innerWidth;
    const currentHeight = window.innerHeight;

    // --- Scene ---
    sceneRef.current = new THREE.Scene();
    sceneRef.current.background = new THREE.Color(0xe3e3db); // Match body background

    // --- Camera ---
    cameraRef.current = new THREE.PerspectiveCamera(
      45, // fov
      currentWidth / currentHeight, // aspect
      0.1, // near
      100 // far
    );
    cameraRef.current.position.z = 5; // Move camera back

    // --- Renderer ---
    rendererRef.current = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      // preserveDrawingBuffer: true, // Optional: if you need to capture canvas
    });
    rendererRef.current.setSize(currentWidth, currentHeight);
    rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // --- Create Slides ---
    slides.length = 0; // Clear previous slides if any (e.g., on HMR)
    for (let i = 0; i < slideCount; i++) {
      createSlide(i);
    }

    // --- Center the slides initially ---
    slides.forEach((slide) => {
      slide.position.x -= totalWidth / 2; // Initial centering offset
      slide.userData.targetX = slide.position.x; // Update target after centering
      slide.userData.currentX = slide.position.x; // Update current after centering
    });
    currentPosition.current = -totalWidth / 2; // Adjust scroll position due to centering
    targetPosition.current = -totalWidth / 2;

    // --- Event Listeners ---
    let scrollTimeout: NodeJS.Timeout | null = null;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault(); // Prevent default page scroll
      const wheelStrength = Math.min(Math.abs(e.deltaY) * 0.001, 1.0); // Normalize and cap strength
      targetDistortionFactor.current = Math.min(
        1.0,
        targetDistortionFactor.current + wheelStrength
      ); // Increase distortion
      targetPosition.current -= e.deltaY * settings.wheelSensitivity;
      isScrolling.current = true;
      autoScrollSpeed.current =
        Math.min(Math.abs(e.deltaY) * 0.0005, 0.05) * Math.sign(e.deltaY); // Apply momentum

      // Detect scroll end
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        isScrolling.current = false;
      }, 150); // Adjust timeout duration as needed
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        targetPosition.current += slideUnit;
        targetDistortionFactor.current = Math.min(
          1.0,
          targetDistortionFactor.current + 0.3
        );
      } else if (e.key === "ArrowRight") {
        targetPosition.current -= slideUnit;
        targetDistortionFactor.current = Math.min(
          1.0,
          targetDistortionFactor.current + 0.3
        );
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
      touchLastX.current = touchStartX.current;
      isScrolling.current = false; // Stop any momentum scrolling
      autoScrollSpeed.current = 0;
      peakVelocity.current = 0; // Reset peak velocity on new touch
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault(); // Prevent default page scroll/selection on mobile
      const touchX = e.touches[0].clientX;
      const deltaX = touchX - touchLastX.current;
      touchLastX.current = touchX;

      const touchStrength = Math.min(Math.abs(deltaX) * 0.02, 1.0); // Normalize touch delta
      targetDistortionFactor.current = Math.min(
        1.0,
        targetDistortionFactor.current + touchStrength
      );

      targetPosition.current -= deltaX * settings.touchSensitivity;
      isScrolling.current = true; // Indicate interaction is happening
    };

    const handleTouchEnd = () => {
      const velocity = (touchLastX.current - touchStartX.current) * 0.005; // Calculate final flick velocity
      if (Math.abs(velocity) > 0.5) {
        // Apply momentum only if flick was strong enough
        autoScrollSpeed.current =
          -velocity * settings.momentumMultiplier * 0.05; // Apply momentum with multiplier
        // Amplify distortion briefly based on flick velocity
        targetDistortionFactor.current = Math.min(
          1.0,
          Math.abs(velocity) * 3 * settings.distortionSensitivity
        );
      }
      isScrolling.current = true; // Allow momentum to continue

      // Set a timeout to stop scrolling state after momentum fades
      setTimeout(() => {
        isScrolling.current = false;
      }, 800); // Adjust timeout based on expected momentum duration
    };

    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      if (cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(width, height);
        rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      }
    };

    // Add listeners
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("resize", handleResize);

    // --- Start Animation ---
    lastTime.current = performance.now(); // Initialize lastTime
    animate(lastTime.current);

    // --- Cleanup ---
    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
      canvas.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("resize", handleResize);

      // Dispose Three.js objects
      slides.forEach((slide) => {
        if (slide.geometry) slide.geometry.dispose();
        if (slide.material instanceof THREE.Material) {
          if ((slide.material as THREE.MeshBasicMaterial).map) {
            (slide.material as THREE.MeshBasicMaterial).map?.dispose();
          }
          slide.material.dispose();
        }
        sceneRef.current?.remove(slide);
      });
      slides.length = 0; // Clear the array
      rendererRef.current?.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      if (scrollTimeout) clearTimeout(scrollTimeout);
    };
  }, [animate, createSlide, settings, slideCount, slideUnit, totalWidth]); // Add dependencies for useEffect

  return (
    <canvas ref={canvasRef} className="fixed inset-0 w-full h-full -z-10" />
  ); // Ensure canvas is behind content
};

export default ThreeSlider;
