/**
 * Photorealistic weather backdrop:
 * landscape photo + parallax, soft clouds, birds, pollen, light rays.
 * (No separate tree PNGs — they had opaque white backgrounds.)
 */
const BIRDS = [
  { top: '14%', size: 18, duration: 26, delay: 0, path: 1 },
  { top: '17%', size: 14, duration: 30, delay: -7, path: 2 },
  { top: '12%', size: 16, duration: 22, delay: -12, path: 1 },
  { top: '20%', size: 12, duration: 34, delay: -3, path: 3 },
  { top: '15%', size: 15, duration: 28, delay: -16, path: 2 },
  { top: '11%', size: 13, duration: 24, delay: -9, path: 3 },
  { top: '19%', size: 11, duration: 32, delay: -20, path: 1 },
  { top: '13%', size: 17, duration: 27, delay: -5, path: 2 }
]

const POLLEN = Array.from({ length: 18 }, (_, i) => ({
  left: `${6 + ((i * 17) % 88)}%`,
  delay: `${(i % 9) * 0.7}s`,
  duration: `${10 + (i % 6) * 1.4}s`,
  size: 2 + (i % 4)
}))

const BirdSvg = ({ size }) => (
  <svg viewBox="0 0 32 16" width={size} height={size * 0.5} className="wab-bird-svg">
    <path className="wab-wing wab-wing--l" d="M16 8 C11 3 5 1.5 2 3.5" />
    <path className="wab-wing wab-wing--r" d="M16 8 C21 3 27 1.5 30 3.5" />
  </svg>
)

const WeatherAnimatedBg = () => (
  <div className="weather-animated-bg" aria-hidden="true">
    <div className="wab-photo-stack">
      <div className="wab-photo wab-photo--base" />
      <div className="wab-photo wab-photo--grain" />
    </div>

    <div className="wab-sun-glow" />
    <div className="wab-godrays" />

    <div className="wab-cloud-layer">
      <span className="wab-soft-cloud wab-soft-cloud--a" />
      <span className="wab-soft-cloud wab-soft-cloud--b" />
      <span className="wab-soft-cloud wab-soft-cloud--c" />
      <span className="wab-soft-cloud wab-soft-cloud--d" />
    </div>

    <div className="wab-birds">
      {BIRDS.map((bird, i) => (
        <span
          key={i}
          className={`wab-bird wab-bird-path--${bird.path}`}
          style={{
            top: bird.top,
            animationDuration: `${bird.duration}s`,
            animationDelay: `${bird.delay}s`
          }}
        >
          <BirdSvg size={bird.size} />
        </span>
      ))}
    </div>

    <div className="wab-pollen">
      {POLLEN.map((p, i) => (
        <span
          key={i}
          className="wab-grain"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            animationDelay: p.delay,
            animationDuration: p.duration
          }}
        />
      ))}
    </div>

    <div className="wab-heat" />
    <div className="wab-grass-shimmer" />
    <div className="wab-vignette" />
  </div>
)

export default WeatherAnimatedBg
