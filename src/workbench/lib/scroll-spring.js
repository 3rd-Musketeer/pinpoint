// Exact critically damped spring solution; seconds and CSS pixels.
// Response is the natural period, not a fixed animation duration.
export function advanceScrollSpring(position, velocity, target, seconds, response = 0.4) {
  const omega = 2 * Math.PI / response;
  const displacement = position - target;
  const coefficient = velocity + omega * displacement;
  const decay = Math.exp(-omega * seconds);
  return {
    position: target + (displacement + coefficient * seconds) * decay,
    velocity: (velocity - omega * coefficient * seconds) * decay,
  };
}
