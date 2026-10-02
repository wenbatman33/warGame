// 水面：依高度場算水深 → 淺青到深藍、岸邊白色泡沫、流動波紋、太陽高光
import * as THREE from 'three';
import type { Heightfield } from '../map/heightfield';
import { WATER_LEVEL } from '../map/heightfield';
import { GLSL_NOISE } from './terrain';

export const waterTime = { value: 0 };
/** 天色亮度（白天 1、黃昏 0.85、夜晚 0.38） */
export const waterTint = { value: 1 };

export function buildWater(hf: Heightfield, heightTex: THREE.Texture, sunDir: THREE.Vector3): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(hf.size, hf.size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uHeight: { value: heightTex },
        uSize: { value: hf.size },
        uTime: waterTime,
        uTint: waterTint,
        uSun: { value: sunDir },
        uShallow: { value: new THREE.Color('#62d3cf') },
        uDeep: { value: new THREE.Color('#1d7fae') },
        uFoam: { value: new THREE.Color('#f4fbff') },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uHeight;
      uniform float uSize;
      uniform float uTime;
      uniform vec3 uSun;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uFoam;
      uniform float uTint;
      varying vec3 vW;
      ${GLSL_NOISE}
      void main() {
        vec2 uv = vW.xz / uSize + 0.5;
        float ground = texture2D(uHeight, uv).r;
        float depth = ${WATER_LEVEL.toFixed(1)} - ground;
        if (depth < -0.05) discard;
        // 波紋法線
        vec2 p = vW.xz * 0.18;
        float n1 = tNoise(p + vec2(uTime * 0.35, uTime * 0.12));
        float n2 = tNoise(p * 2.3 - vec2(uTime * 0.2, uTime * 0.4));
        vec3 nrm = normalize(vec3((n1 - 0.5) * 0.35 + (n2 - 0.5) * 0.2, 1.0, (n2 - 0.5) * 0.35));
        float d = clamp(depth / 2.2, 0.0, 1.0);
        vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 1.0, d));
        // 岸邊泡沫（帶噪聲、會動）
        float foamN = tNoise(vW.xz * 0.7 + vec2(uTime * 0.5, 0.0));
        float foam = smoothstep(0.45, 0.0, depth + (foamN - 0.5) * 0.35) * 0.9;
        foam += smoothstep(0.75, 0.95, n2) * 0.12;
        col = mix(col, uFoam, clamp(foam, 0.0, 1.0));
        // 高光
        vec3 viewDir = normalize(cameraPosition - vW);
        vec3 h = normalize(uSun + viewDir);
        float spec = pow(max(dot(nrm, h), 0.0), 90.0) * 0.9;
        float fres = pow(1.0 - max(dot(viewDir, nrm), 0.0), 3.0);
        col += vec3(spec) + fres * vec3(0.18, 0.25, 0.3);
        col *= uTint;
        float alpha = mix(0.55, 0.92, smoothstep(0.0, 1.2, depth));
        alpha = max(alpha, foam);
        gl_FragColor = vec4(col, alpha * smoothstep(-0.05, 0.08, depth));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL;
  mesh.renderOrder = 2;
  mesh.name = 'water';
  return mesh;
}
