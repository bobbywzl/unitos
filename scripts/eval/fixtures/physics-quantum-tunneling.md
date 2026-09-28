# Quantum Tunneling: Through a Wall an Electron Cannot Climb

A ball rolled at a hill with too little energy rolls back every time. An electron sent at an energy barrier it cannot climb sometimes comes out on the other side. This explainer follows one electron to one thin barrier, splits the outcome into what reflects and what transmits, shows why the transmitted part shrinks exponentially with the barrier's width, and ends with the microscope that turns this effect into pictures of single atoms.

## The setup

An electron moves along the x axis with a kinetic energy of E = 2 eV. It is not a point but a wave packet: a ripple with a wavelength of about 0.87 nm inside a bell-shaped envelope a few nanometres wide, moving to the right. Ahead of it sits a rectangular barrier: a region of width a in which the potential energy is V0 = 3 eV, and zero on both sides. Classically the electron is 1 eV short of the top and must bounce back.

## The Schrödinger equation

The packet obeys the time-dependent Schrödinger equation, iħ ∂ψ/∂t = −(ħ²/2m) ∂²ψ/∂x² + V(x)ψ. Here ψ(x, t) is the wave function, and |ψ|² is the probability density of finding the electron at x. The first term on the right is the kinetic energy, set by how sharply ψ curves; m = 9.11 × 10⁻³¹ kg is the electron mass and ħ = 1.055 × 10⁻³⁴ J·s is the reduced Planck constant. The second term is the potential energy, V(x) = V0 inside the barrier and 0 outside. The equation keeps the total probability, the integral of |ψ|² over all x, equal to 1 at all times.

Outside the barrier the solution oscillates. Inside, where V0 is greater than E, it does not: it decays as exp(−κx), with κ = √(2m(V0 − E))/ħ. For V0 − E = 1 eV, κ ≈ 5.1 nm⁻¹, so the wave function loses a factor of e in about 0.2 nm. If the barrier is thin enough, a part of the wave function is still left at the far edge, and from there it oscillates again.

## Reflection and transmission

When the packet reaches the barrier, it splits. Most of it turns around and travels back to the left; while the incoming and reflected waves overlap, they interfere and draw a row of fringes in |ψ|². A smaller packet emerges on the right and moves on with the same energy and the same wavelength, only with less amplitude. Once the collision is over, nothing stays inside the barrier. The reflection probability R and the transmission probability T add up to 1. The electron itself is never split: a detector finds the whole electron on one side, on the right with probability T and on the left with probability R.

## Width matters exponentially

For a thick barrier, T ≈ 16 (E/V0)(1 − E/V0) exp(−2κa). The width sits in the exponent, so adding the same thickness divides T by the same factor. For our electron, once the barrier is thicker than about half a nanometre, every extra 0.25 nm divides T by about 13. Doubling the width does not halve the transmission; it roughly squares the exponential factor.

| Barrier width | Transmission T |
|---|---|
| 0.25 nm | 24% |
| 0.50 nm | 2.1% |
| 0.75 nm | 0.16% |
| 1.00 nm | 0.013% |

## The scanning tunneling microscope

The scanning tunneling microscope, built by Gerd Binnig and Heinrich Rohrer at IBM Zurich in 1981, uses this exponential as a ruler. A sharp metal tip, ideally ending in a single atom, is held about 0.5 to 1 nm above a conducting surface. The vacuum gap between them is the barrier; its height is set by the work function of the metals, about 4 to 5 eV. A small voltage, typically 0.1 to 1 V, drives electrons through the gap, and the tunneling current is around 1 nA. Because the barrier is higher than in our example, κ is about 11 nm⁻¹, and the current falls by roughly a factor of 10 for every 0.1 nm the gap widens. Piezoelectric crystals move the tip across the surface in steps smaller than an atom. A feedback loop raises or lowers the tip to hold the current constant, and the recorded height of the tip is the map of the surface. Almost all of the current flows through the one tip atom closest to the surface, so the microscope resolves single atoms: better than 0.1 nm across and about 0.01 nm in height. Binnig and Rohrer received half of the 1986 Nobel Prize in Physics for it.
