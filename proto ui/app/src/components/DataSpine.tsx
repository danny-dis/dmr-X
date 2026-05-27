import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

function DataTube() {
  const tubeRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Group>(null);

  const curve = useMemo(() => {
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(-25, 2, -15),
      new THREE.Vector3(-10, -3, -5),
      new THREE.Vector3(0, 4, 5),
      new THREE.Vector3(10, -2, 10),
      new THREE.Vector3(25, 1, 18),
    ]);
  }, []);

  const tubeGeometry = useMemo(() => {
    return new THREE.TubeGeometry(curve, 300, 2, 32, false);
  }, [curve]);

  const particles = useMemo(() => {
    return Array.from({ length: 150 }, () => ({
      offset: Math.random(),
      speed: 0.02 + Math.random() * 0.03,
      size: 0.15 + Math.random() * 0.2,
      color: Math.random() > 0.5 ? '#F7A51C' : '#00E0FF',
    }));
  }, []);

  const particleRefs = useRef<THREE.Mesh[]>([]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;

    // Pulse tube
    if (tubeRef.current) {
      const mat = tubeRef.current.material as THREE.MeshPhysicalMaterial;
      mat.emissiveIntensity = 0.3 + Math.sin(time * 2) * 0.1;
    }

    // Animate particles
    particleRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const p = particles[i];
      const t = (time * p.speed + p.offset) % 1;
      const point = curve.getPointAt(t);
      mesh.position.copy(point);

      // Vary size by depth
      const scale = 0.6 + (point.z + 15) / 33;
      mesh.scale.setScalar(p.size * scale);
    });
  });

  return (
    <group>
      {/* Main tube */}
      <mesh ref={tubeRef} geometry={tubeGeometry}>
        <meshPhysicalMaterial
          color="#F7A51C"
          emissive="#d97706"
          emissiveIntensity={0.3}
          roughness={0.1}
          metalness={0.1}
          transmission={0.6}
          opacity={0.6}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Particles */}
      <group ref={particlesRef}>
        {particles.map((p, i) => (
          <mesh
            key={i}
            ref={(el) => {
              if (el) particleRefs.current[i] = el;
            }}
          >
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial color={p.color} transparent opacity={0.8} />
          </mesh>
        ))}
      </group>

      {/* Inner glow line */}
      <mesh geometry={new THREE.TubeGeometry(curve, 300, 0.5, 16, false)}>
        <meshBasicMaterial color="#F7A51C" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <directionalLight position={[-10, -5, -5]} intensity={0.3} color="#00E0FF" />
      <DataTube />
    </>
  );
}

export default function DataSpine() {
  return (
    <div className="absolute inset-0 z-0">
      <Canvas
        camera={{ position: [0, 0, 35], fov: 60 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <fog attach="fog" args={['#060608', 20, 90]} />
        <Scene />
      </Canvas>
    </div>
  );
}
