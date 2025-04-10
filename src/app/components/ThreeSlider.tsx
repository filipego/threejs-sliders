"use client";

import React, { useRef, useEffect, useCallback } from "react";
import * as THREE from "three";

// --- NEW: Props Interface ---
interface ThreeSliderProps {
  /** Width of each slide plane in 3D units. Default: 3.0 */
  slideWidth?: number;
  /** Height of each slide plane in 3D units. Default: 1.5 */
  slideHeight?: number;
  /** Gap between each slide plane in 3D units. Default: 0.1 */
  gap?: number;
  /** How the image should fit the slide dimensions. Default: 'contain' */
  imageFitMode?: "contain" | "cover";
  /** Optional: Number of slide planes to create (can be > image count for looping). Default: 10 */
  slideCount?: number;
  /** Optional: Number of actual images available in /public/imgs/. Default: 5 */
  imagesAvailable?: number;
}

const ThreeSlider: React.FC<ThreeSliderProps> = ({
  // --- NEW: Destructure props with defaults ---
  slideWidth: slideWidthProp = 3.0,
  slideHeight: slideHeightProp = 1.5,
  gap: gapProp = 0.1,
  imageFitMode = "contain",
  slideCount: slideCountProp = 10,
  imagesAvailable = 5,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  // slidesRef removed, using 'slides' array
  const animationFrameId = useRef<number | null>(null);

  // --- Settings and State Variables (Internal) ---
  const settings = useRef({
    wheelSensitivity: 0.01,
    touchSensitivity: 0.01, // Keep touch sensitivity for mobile scroll simulation
    momentumMultiplier: 2,
    smoothing: 0.1,
    slideLerp: 0.075,
    distortionDecay: 0.95,
    maxDistortion: 2.5,
    distortionSensitivity: 0.15,
    distortionSmoothing: 0.075,
  }).current;

  // --- Use Props for Constants ---
  const slideWidth = slideWidthProp;
  const slideHeight = slideHeightProp;
  const gap = gapProp;
  const slideCount = slideCountProp;
  const imagesCount = imagesAvailable; // Use prop
  const totalWidth = slideCount * (slideWidth + gap); // Recalculated
  const slideUnit = slideWidth + gap; // Recalculated

  // --- Mutable State Refs ---
  const slides = useRef<THREE.Mesh[]>([]).current;
  const currentPosition = useRef(0);
  const targetPosition = useRef(0);
  const isScrolling = useRef(false); // Used for scroll/touch momentum detection
  const autoScrollSpeed = useRef(0);
  const lastTime = useRef(0);
  const touchStartX = useRef(0); // Still needed for touch scroll velocity
  const touchLastX = useRef(0); // Still needed for touch scroll delta
  const prevPosition = useRef(0);
  const currentDistortionFactor = useRef(0);
  const targetDistortionFactor = useRef(0);
  const peakVelocity = useRef(0);
  const velocityHistory = useRef<number[]>(Array(5).fill(0)).current;

  // --- Helper Functions ---
  const correctImageColor = useCallback((texture: THREE.Texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  const createSlide = useCallback(
    (index: number) => {
      // Use prop values for geometry
      const geometry = new THREE.PlaneGeometry(slideWidth, slideHeight, 32, 16);
      const colors = ["#FF5733", "#33FF57", "#3357FF", "#F3F33F", "#FF33F3"];
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colors[index % colors.length]),
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.x = index * slideUnit; // Use recalculated slideUnit
      mesh.userData = {
        originalVertices: [
          ...(geometry.attributes.position.array as Float32Array),
        ],
        index: index,
        targetX: mesh.position.x,
        currentX: mesh.position.x,
      };
      const imageIndex = (index % imagesCount) + 1; // Use prop imagesCount
      const imagePath = `/imgs/${imageIndex}.jpg`;
      new THREE.TextureLoader().load(
        imagePath,
        (texture) => {
          correctImageColor(texture);
          material.map = texture;
          material.color.set(0xffffff);
          material.needsUpdate = true;

          // --- NEW: Image Scaling based on prop ---
          const imgAspect = texture.image.width / texture.image.height;
          const slideAspect = slideWidth / slideHeight; // Use prop values
          mesh.scale.set(1, 1, 1); // Reset scale
          if (imageFitMode === "contain") {
            if (imgAspect > slideAspect) {
              mesh.scale.y = slideAspect / imgAspect;
            } else {
              mesh.scale.x = imgAspect / slideAspect;
            }
          } else {
            // 'cover' mode
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
    ] // Added props
  );

  const updateCurve = useCallback(
    (mesh: THREE.Mesh, worldPositionX: number, distortionFactor: number) => {
      if (!mesh || !mesh.geometry || !mesh.userData.originalVertices) return;
      const distortionCenter = new THREE.Vector2(0, 0);
      const distortionRadius = 2.0;
      const maxCurvature = settings.maxDistortion * distortionFactor;
      const positionAttribute = mesh.geometry.attributes.position;
      const originalVertices = mesh.userData.originalVertices as Float32Array;
      for (let i = 0; i < positionAttribute.count; i++) {
        const x = originalVertices[i * 3];
        const y = originalVertices[i * 3 + 1];
        // Use scale in world position calculation
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

  // --- Animation Loop ---
  const animate = useCallback(
    (time: number) => {
      animationFrameId.current = requestAnimationFrame(animate);
      const deltaTime = lastTime.current
        ? (time - lastTime.current) / 1000
        : 0.016;
      lastTime.current = time;
      prevPosition.current = currentPosition.current;

      // Apply momentum if scrolling state is true (set by wheel/touch end)
      if (isScrolling.current && Math.abs(autoScrollSpeed.current) > 0.001) {
        // Check speed threshold
        targetPosition.current += autoScrollSpeed.current;
        const speedBasedDecay = 0.97 - Math.abs(autoScrollSpeed.current) * 0.5;
        autoScrollSpeed.current *= Math.max(0.92, speedBasedDecay);
        if (Math.abs(autoScrollSpeed.current) < 0.001) {
          autoScrollSpeed.current = 0;
          // Optionally reset isScrolling here or rely on the timeout
          // isScrolling.current = false;
        }
      } else {
        // Ensure momentum stops if scrolling state is false or speed is negligible
        autoScrollSpeed.current = 0;
      }

      // Interpolate current position towards target (smoothing)
      currentPosition.current +=
        (targetPosition.current - currentPosition.current) * settings.smoothing;

      // Velocity & Distortion logic... (unchanged)
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
      if (currentVelocity > 0.05) {
        // Removed isDragging check here
        targetDistortionFactor.current = Math.max(
          targetDistortionFactor.current,
          movementDistortion
        );
      }
      // Decay uses isScrolling state (set by wheel/touch) instead of isDragging
      const decayRate =
        isDecelerating || avgVelocity < 0.2 || !isScrolling.current
          ? settings.distortionDecay
          : settings.distortionDecay * 0.9; // Adjusted multiplier slightly
      targetDistortionFactor.current *= decayRate;
      currentDistortionFactor.current +=
        (targetDistortionFactor.current - currentDistortionFactor.current) *
        settings.distortionSmoothing;

      // Update slides (uses prop-based totalWidth/slideUnit/slideWidth)
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

      // Render
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    },
    [
      settings,
      updateCurve,
      slides,
      totalWidth, // Prop dependent
      slideUnit, // Prop dependent
      slideWidth, // Prop dependent
    ]
  );

  // --- Initialization and Event Listeners ---
  useEffect(() => {
    if (!canvasRef.current) return; // Guard clause only for canvas

    const canvas = canvasRef.current;
    const currentWidth = window.innerWidth;
    const currentHeight = window.innerHeight;

    // Scene setup
    sceneRef.current = new THREE.Scene();
    sceneRef.current.background = new THREE.Color(0xe3e3db);

    // Camera setup (assign .current)
    cameraRef.current = new THREE.PerspectiveCamera(
      45,
      currentWidth / currentHeight,
      0.1,
      100
    );
    cameraRef.current.position.z = 5;

    // Renderer setup
    rendererRef.current = new THREE.WebGLRenderer({ canvas, antialias: true });
    rendererRef.current.setSize(currentWidth, currentHeight);
    rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Create Slides (uses prop slideCount)
    slides.length = 0;
    for (let i = 0; i < slideCount; i++) {
      // Use prop slideCount
      createSlide(i);
    }

    // Initial Centering (uses recalculated totalWidth)
    slides.forEach((slide) => {
      slide.position.x -= totalWidth / 2;
      slide.userData.targetX = slide.position.x;
      slide.userData.currentX = slide.position.x;
    });
    currentPosition.current = -totalWidth / 2;
    targetPosition.current = -totalWidth / 2;

    // --- Scroll/Touch/Keyboard Event Listeners (Original Logic) ---
    let scrollTimeout: NodeJS.Timeout | null = null;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const wheelStrength = Math.min(Math.abs(e.deltaY) * 0.001, 1.0);
      targetDistortionFactor.current = Math.min(
        1.0,
        targetDistortionFactor.current + wheelStrength
      );
      targetPosition.current -= e.deltaY * settings.wheelSensitivity;
      isScrolling.current = true; // Set scrolling state
      autoScrollSpeed.current =
        Math.min(Math.abs(e.deltaY) * 0.0005, 0.05) * Math.sign(e.deltaY);
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        isScrolling.current = false;
      }, 150);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Use recalculated slideUnit
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
      isScrolling.current = false; // Stop momentum
      autoScrollSpeed.current = 0;
      peakVelocity.current = 0;
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touchX = e.touches[0].clientX;
      const deltaX = touchX - touchLastX.current;
      touchLastX.current = touchX;
      const touchStrength = Math.min(Math.abs(deltaX) * 0.02, 1.0);
      targetDistortionFactor.current = Math.min(
        1.0,
        targetDistortionFactor.current + touchStrength
      );
      targetPosition.current -= deltaX * settings.touchSensitivity;
      // No need to set isScrolling true here, touchEnd handles momentum start
    };

    const handleTouchEnd = () => {
      const velocity = (touchLastX.current - touchStartX.current) * 0.005;
      if (Math.abs(velocity) > 0.5) {
        autoScrollSpeed.current =
          -velocity * settings.momentumMultiplier * 0.05;
        targetDistortionFactor.current = Math.min(
          1.0,
          Math.abs(velocity) * 3 * settings.distortionSensitivity
        );
        isScrolling.current = true; // Start momentum phase
        // Set timeout to stop isScrolling after momentum likely fades
        setTimeout(() => {
          isScrolling.current = false;
        }, 800);
      } else {
        isScrolling.current = false; // No momentum, ensure scrolling stops
      }
    };

    // --- Resize Listener (Original - uses window size) ---
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
    lastTime.current = performance.now();
    animate(lastTime.current);

    // --- Cleanup ---
    return () => {
      if (animationFrameId.current)
        cancelAnimationFrame(animationFrameId.current);
      canvas.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("resize", handleResize);
      slides.forEach((slide) => {
        /* ... dispose logic ... */
      });
      slides.length = 0;
      rendererRef.current?.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      if (scrollTimeout) clearTimeout(scrollTimeout);
    };
  }, [
    // --- NEW: Add props to useEffect dependencies ---
    slideWidth,
    slideHeight,
    gap,
    slideCount, // Use prop name
    imagesCount, // Use derived name from prop
    imageFitMode,
    // Other dependencies
    animate,
    createSlide,
    settings,
    totalWidth, // Derived, changes with props
    slideUnit, // Derived, changes with props
    // Removed updateCurve as it's only used inside animate
    // Added slides as it's used in createSlide loop and initial centering
    slides,
  ]);

  // Keep original full-screen canvas setup
  return (
    <canvas ref={canvasRef} className="fixed inset-0 w-full h-full -z-10" />
  );
};

export default ThreeSlider;
