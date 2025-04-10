"use client";

import React, { useRef, useEffect, useCallback } from "react";
import * as THREE from "three";

// Props Interface (unchanged)
interface ThreeSliderDraggableProps {
  slideWidth?: number;
  slideHeight?: number;
  gap?: number;
  imageFitMode?: "contain" | "cover";
  slideCount?: number;
  imagesAvailable?: number;
}

const ThreeSliderDraggable: React.FC<ThreeSliderDraggableProps> = ({
  // Destructure props with defaults (unchanged)
  slideWidth: slideWidthProp = 3.0,
  slideHeight: slideHeightProp = 1.5,
  gap: gapProp = 0.1,
  imageFitMode = "contain",
  slideCount: slideCountProp = 10,
  imagesAvailable = 5,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animationFrameId = useRef<number | null>(null);

  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());

  // Settings (Internal - unchanged)
  const settings = useRef({
    dragSensitivity: 0.02,
    momentumMultiplier: 2,
    smoothing: 0.1,
    slideLerp: 0.075,
    distortionDecay: 0.95,
    maxDistortion: 2.5,
    distortionSensitivity: 0.15,
    distortionSmoothing: 0.075,
  }).current;

  // Use Props for Constants (unchanged)
  const slideWidth = slideWidthProp;
  const slideHeight = slideHeightProp;
  const gap = gapProp;
  const slideCount = slideCountProp;
  const imagesCount = imagesAvailable;
  const totalWidth = slideCount * (slideWidth + gap);
  const slideUnit = slideWidth + gap; // Recalculated based on props

  // Mutable State Refs (unchanged)
  const slides = useRef<THREE.Mesh[]>([]).current;
  const currentPosition = useRef(0);
  const targetPosition = useRef(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragLastX = useRef(0);
  const autoScrollSpeed = useRef(0);
  const lastTime = useRef(0);
  const prevPosition = useRef(0);
  const currentDistortionFactor = useRef(0);
  const targetDistortionFactor = useRef(0);
  const peakVelocity = useRef(0);
  const velocityHistory = useRef<number[]>(Array(5).fill(0)).current;

  // Helper Functions (unchanged)
  const correctImageColor = useCallback(
    /* ... */ (texture: THREE.Texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    },
    []
  );
  const createSlide = useCallback(
    /* ... */ (index: number) => {
      const geometry = new THREE.PlaneGeometry(slideWidth, slideHeight, 32, 16);
      const colors = ["#FF5733", "#33FF57", "#3357FF", "#F3F33F", "#FF33F3"];
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colors[index % colors.length]),
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.x = index * slideUnit;
      mesh.userData = {
        originalVertices: [
          ...(geometry.attributes.position.array as Float32Array),
        ],
        index: index,
        targetX: mesh.position.x,
        currentX: mesh.position.x,
      };
      const imageIndex = (index % imagesCount) + 1;
      const imagePath = `/imgs/${imageIndex}.jpg`;
      new THREE.TextureLoader().load(
        imagePath,
        (texture) => {
          correctImageColor(texture);
          material.map = texture;
          material.color.set(0xffffff);
          material.needsUpdate = true;
          const imgAspect = texture.image.width / texture.image.height;
          const slideAspect = slideWidth / slideHeight;
          mesh.scale.set(1, 1, 1);
          if (imageFitMode === "contain") {
            if (imgAspect > slideAspect) {
              mesh.scale.y = slideAspect / imgAspect;
            } else {
              mesh.scale.x = imgAspect / slideAspect;
            }
          } else {
            if (imgAspect > slideAspect) {
              mesh.scale.x = imgAspect / slideAspect;
            } else {
              mesh.scale.y = slideAspect / imgAspect;
            }
          }
        },
        undefined,
        (err) => {
          console.warn(`Couldn't load image ${imagePath}`, err);
        }
      );
      sceneRef.current?.add(mesh);
      slides.push(mesh);
    },
    [
      correctImageColor,
      imagesCount,
      slideHeight,
      slideUnit,
      slideWidth,
      imageFitMode,
    ]
  );
  const updateCurve = useCallback(
    /* ... */ (
      mesh: THREE.Mesh,
      worldPositionX: number,
      distortionFactor: number
    ) => {
      if (!mesh || !mesh.geometry || !mesh.userData.originalVertices) return;
      const distortionCenter = new THREE.Vector2(0, 0);
      const distortionRadius = 2.0;
      const maxCurvature = settings.maxDistortion * distortionFactor;
      const positionAttribute = mesh.geometry.attributes.position;
      const originalVertices = mesh.userData.originalVertices as Float32Array;
      for (let i = 0; i < positionAttribute.count; i++) {
        const x = originalVertices[i * 3];
        const y = originalVertices[i * 3 + 1];
        const vertexWorldPosX = worldPositionX + x * mesh.scale.x;
        const vertexWorldPosY = y * mesh.scale.y;
        const distFromCenter = Math.sqrt(
          Math.pow(vertexWorldPosX - distortionCenter.x, 2) +
            Math.pow(vertexWorldPosY - distortionCenter.y, 2)
        );
        const distortionStrength = Math.max(
          0,
          1 - distFromCenter / distortionRadius
        );
        const curveZ =
          Math.pow(Math.sin((distortionStrength * Math.PI) / 2), 1.5) *
          maxCurvature;
        positionAttribute.setZ(i, curveZ);
      }
      positionAttribute.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    },
    [settings.maxDistortion]
  );

  // Animation Loop (unchanged - correct dependencies assumed based on previous analysis)
  const animate = useCallback(
    /* ... */ (time: number) => {
      animationFrameId.current = requestAnimationFrame(animate);
      const deltaTime = lastTime.current
        ? (time - lastTime.current) / 1000
        : 0.016;
      lastTime.current = time;
      prevPosition.current = currentPosition.current;
      if (!isDragging.current && Math.abs(autoScrollSpeed.current) > 0.001) {
        targetPosition.current += autoScrollSpeed.current;
        const speedBasedDecay = 0.97 - Math.abs(autoScrollSpeed.current) * 0.5;
        autoScrollSpeed.current *= Math.max(0.92, speedBasedDecay);
        if (Math.abs(autoScrollSpeed.current) < 0.001)
          autoScrollSpeed.current = 0;
      } else if (!isDragging.current) {
        autoScrollSpeed.current = 0;
      }
      currentPosition.current +=
        (targetPosition.current - currentPosition.current) * settings.smoothing;
      const currentVelocity = Math.max(
        0,
        Math.abs(currentPosition.current - prevPosition.current) / deltaTime
      );
      velocityHistory.push(currentVelocity);
      velocityHistory.shift();
      const avgVelocity =
        velocityHistory.reduce((sum, val) => sum + val, 0) /
        velocityHistory.length;
      if (avgVelocity > peakVelocity.current)
        peakVelocity.current = avgVelocity;
      const velocityRatio =
        peakVelocity.current > 0.001 ? avgVelocity / peakVelocity.current : 0;
      const isDecelerating = velocityRatio < 0.7 && peakVelocity.current > 0.5;
      peakVelocity.current *= 0.99;
      const movementDistortion = Math.min(
        1.0,
        currentVelocity * settings.distortionSensitivity
      );
      if (currentVelocity > 0.05 || isDragging.current) {
        targetDistortionFactor.current = Math.max(
          targetDistortionFactor.current,
          movementDistortion
        );
      }
      const decayRate =
        isDecelerating || avgVelocity < 0.2 || !isDragging.current
          ? settings.distortionDecay
          : settings.distortionDecay * 0.98;
      targetDistortionFactor.current *= decayRate;
      currentDistortionFactor.current +=
        (targetDistortionFactor.current - currentDistortionFactor.current) *
        settings.distortionSmoothing;
      slides.forEach((slide, i) => {
        let baseX = i * slideUnit - currentPosition.current;
        baseX = ((baseX % totalWidth) + totalWidth) % totalWidth;
        if (baseX > totalWidth / 2) baseX -= totalWidth;
        const isWrapping =
          Math.abs(baseX - slide.userData.targetX) > slideWidth * 2;
        if (isWrapping) slide.userData.currentX = baseX;
        slide.userData.targetX = baseX;
        slide.userData.currentX +=
          (slide.userData.targetX - slide.userData.currentX) *
          settings.slideLerp;
        const wrapThreshold = totalWidth / 2 + slideWidth;
        if (Math.abs(slide.userData.currentX) < wrapThreshold * 1.5) {
          slide.position.x = slide.userData.currentX;
          updateCurve(slide, slide.position.x, currentDistortionFactor.current);
        }
      });
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    },
    [settings, updateCurve, slides, totalWidth, slideUnit, slideWidth]
  ); // Added slideWidth

  // Initialization and Event Listeners
  useEffect(() => {
    // Ensure refs are ready
    if (!containerRef.current || !canvasRef.current) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    let currentWidth = container.clientWidth; // Use let for potential re-assignment
    let currentHeight = container.clientHeight;

    // Initial size might be 0, use fallback and schedule re-check
    if (currentWidth === 0 || currentHeight === 0) {
      console.warn("Container dimensions initially zero, using fallback.");
      currentWidth = window.innerWidth; // Use window size as initial fallback
      currentHeight = window.innerHeight * 0.5; // Example: 50% vh fallback height
      // Re-run setup slightly later after layout stabilizes
      const timer = setTimeout(() => handleResize(), 50);
      // Cleanup this specific timer if component unmounts quickly
      // The main cleanup will handle the event listener itself
      return () => clearTimeout(timer);
    }

    const aspectRatio = currentWidth / currentHeight;

    // --- Scene, Camera, Renderer Setup ---
    // Scene
    sceneRef.current = new THREE.Scene();
    // Camera
    cameraRef.current = new THREE.PerspectiveCamera(45, aspectRatio, 0.1, 100);
    cameraRef.current.position.z = 5;
    // Renderer
    rendererRef.current = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    rendererRef.current.setSize(currentWidth, currentHeight);
    rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current.setClearColor(0x000000, 0);

    // --- Create Slides & Initial Centering ---
    slides.length = 0; // Clear before creating
    // Use props directly here, they are stable within this effect run
    const effectSlideCount = slideCountProp;
    const effectTotalWidth = effectSlideCount * (slideWidthProp + gapProp);
    for (let i = 0; i < effectSlideCount; i++) {
      createSlide(i); // createSlide uses prop values via closure
    }
    slides.forEach((slide) => {
      slide.position.x -= effectTotalWidth / 2;
      slide.userData.targetX = slide.position.x;
      slide.userData.currentX = slide.position.x;
    });
    // Adjust position refs based on props used for setup
    currentPosition.current = -effectTotalWidth / 2;
    targetPosition.current = -effectTotalWidth / 2;

    // --- Event Handlers Defined INSIDE useEffect ---
    // These will now close over the correct `slideUnit`, `settings`, etc.
    // from the specific run of useEffect triggered by prop changes.

    const checkSlideIntersection = (
      clientX: number,
      clientY: number
    ): boolean => {
      if (!cameraRef.current || slides.length === 0 || !canvasRef.current)
        return false;
      const rect = canvasRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      mouse.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.current.setFromCamera(mouse.current, cameraRef.current);
      const intersects = raycaster.current.intersectObjects(slides);
      return intersects.length > 0;
    };

    const handleMouseDown = (e: MouseEvent) => {
      const intersects = checkSlideIntersection(e.clientX, e.clientY);
      if (intersects) {
        isDragging.current = true;
        dragStartX.current = e.clientX;
        dragLastX.current = e.clientX;
        autoScrollSpeed.current = 0;
        peakVelocity.current = 0;
        if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const currentlyOverSlide = checkSlideIntersection(e.clientX, e.clientY);
      if (isDragging.current) {
        if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
        const currentX = e.clientX;
        const deltaX = currentX - dragLastX.current;
        dragLastX.current = currentX;
        const dragStrength = Math.min(Math.abs(deltaX) * 0.02, 1.0);
        targetDistortionFactor.current = Math.min(
          1.0,
          targetDistortionFactor.current + dragStrength
        );
        // Use settings directly as it's stable within the effect scope
        targetPosition.current -= deltaX * settings.dragSensitivity;
      } else {
        if (canvasRef.current) {
          canvasRef.current.style.cursor = currentlyOverSlide
            ? "grab"
            : "default";
        }
      }
    };

    const handleMouseUpOrLeave = (e: MouseEvent) => {
      const wasDragging = isDragging.current;
      if (wasDragging) {
        isDragging.current = false;
        const velocity = (dragLastX.current - dragStartX.current) * 0.005;
        if (Math.abs(velocity) > 0.5) {
          // Use settings directly
          autoScrollSpeed.current =
            -velocity * settings.momentumMultiplier * 0.05;
          targetDistortionFactor.current = Math.min(
            1.0,
            targetDistortionFactor.current +
              Math.abs(velocity) * settings.distortionSensitivity * 1.5
          );
        }
      }
      const finallyOverSlide = checkSlideIntersection(e.clientX, e.clientY);
      if (canvasRef.current) {
        canvasRef.current.style.cursor = finallyOverSlide ? "grab" : "default";
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Use the `slideUnit` calculated from props at the top level
      // It's stable within the closure of this useEffect run
      const currentSlideUnit = slideWidthProp + gapProp;
      if (e.key === "ArrowLeft") {
        targetPosition.current += currentSlideUnit;
        targetDistortionFactor.current = Math.min(
          1.0,
          targetDistortionFactor.current + 0.3
        );
      } else if (e.key === "ArrowRight") {
        targetPosition.current -= currentSlideUnit;
        targetDistortionFactor.current = Math.min(
          1.0,
          targetDistortionFactor.current + 0.3
        );
      }
    };

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current)
        return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      if (width === 0 || height === 0) return; // Prevent errors on resize
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
      rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };

    // Add listeners using the handlers defined above
    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUpOrLeave);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);

    // Start Animation
    lastTime.current = performance.now();
    animate(lastTime.current); // animate is defined outside via useCallback

    // Cleanup
    return () => {
      if (animationFrameId.current)
        cancelAnimationFrame(animationFrameId.current);
      // Use same handler references for removal
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUpOrLeave);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
      // Dispose Three.js objects...
      slides.forEach((slide) => {
        if (slide.geometry) slide.geometry.dispose();
        if (slide.material instanceof THREE.Material) {
          const basicMaterial = slide.material as THREE.MeshBasicMaterial;
          if (basicMaterial.map) basicMaterial.map.dispose();
          if (typeof (slide.material as any).dispose === "function") {
            (slide.material as any).dispose();
          }
        }
        sceneRef.current?.remove(slide);
      });
      slides.length = 0;
      rendererRef.current?.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
    };
  }, [
    // Main dependencies for re-running the entire setup
    slideWidthProp,
    slideHeightProp,
    gapProp,
    slideCountProp,
    imagesAvailable,
    imageFitMode,
    // Callbacks defined outside useEffect need to be listed if they depend on props/state
    animate,
    createSlide, // updateCurve is used by animate, so it's covered
    // Derived values are recalculated, no need to list them here
    // settings ref is stable
    // slides array ref is stable
  ]);

  // Container div defines the layout space
  return (
    <div
      ref={containerRef}
      // Removed absolute positioning. Use classes for desired block layout size.
      // Example: aspect-ratio ensures height relative to width. Or use h-96 etc.
      className="w-full aspect-video overflow-hidden relative bg-transparent"
    >
      <canvas
        ref={canvasRef}
        // Canvas fills the container. Initial cursor is default.
        className="w-full h-full block cursor-default"
      />
    </div>
  );
};

export default ThreeSliderDraggable;
