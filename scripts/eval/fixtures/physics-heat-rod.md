# Heat Conduction in a Metal Rod

Heat a metal rod at one point and the heat does not stay there: it flows from hot parts to cold parts. This section writes that flow as an equation, follows it in a copper rod with two kinds of ends, and asks how long it takes.

## The heat equation

Let u(x, t) be the temperature at position x along the rod at time t. For a thin rod with insulated sides, the temperature obeys the heat equation, ∂u/∂t = α ∂²u/∂x². The left side is how fast the temperature at one point changes. The right side is the curvature of the temperature profile, scaled by the thermal diffusivity α. Where the profile bends downward, as at the top of a hot peak, ∂²u/∂x² is negative and the point cools. Where it bends upward, as at the bottom of a cold dip, the point warms. Where the profile is a straight line, nothing changes, even if the line is steep.

The diffusivity is α = k/(ρc): the conductivity divided by the density times the specific heat. Copper has α ≈ 1.1 × 10⁻⁴ m²/s and carbon steel about 1.2 × 10⁻⁵ m²/s, so copper evens out about nine times faster.

## A copper rod with ends in ice water

Take a copper rod 1 m long, at 20 °C throughout. A torch heats the middle 10 cm to 100 °C, and at t = 0 the torch is removed. Both ends are dipped in ice water, which holds them at 0 °C: u(0, t) = u(1 m, t) = 0. The hot spot spreads and sinks at once: after one minute the centre has fallen to about 47 °C and the bump is about three times as wide as the 10 cm we heated. Meanwhile the ice water pulls the 20 °C background down, starting at the ends and moving inward. After five minutes the centre is at about 30 °C and the profile is one smooth hump. After 15 minutes the hump has the shape of half a sine wave with its top at about 16 °C. From then on it keeps that shape and only shrinks: the centre reads about 6 °C at 30 minutes and below 1 °C at one hour.

Why half a sine wave? Any starting profile is a sum of sine waves sin(nπx/L) that fit between the fixed ends, and each decays as exp(−n²π²αt/L²), so the wave with n = 3 fades nine times faster than the wave with n = 1. The sharp edges of the hot spot are made of waves with large n and are rounded off within seconds. What remains is the slowest wave, n = 1, with the time constant L²/(π²α) ≈ 920 s, about 15 minutes.

## Insulated ends

Instead of ice water, wrap both ends in insulation. No heat crosses them, so the slope of the profile at each end is zero: ∂u/∂x = 0 at x = 0 and at x = L. For the first minute the hot spot spreads exactly as before; the ends are too far away to matter yet. The total heat stays constant, and the rod evens out to the mean of its starting temperature: 20 °C plus 80 °C over one tenth of the length, which is 28 °C. After five minutes the centre is at about 32 °C and the ends at about 24 °C. After 15 minutes every point is within half a degree of 28 °C. The ice-water rod drains all its heat and ends at 0 °C; the insulated rod keeps all its heat and ends flat at 28 °C.

## The time scale

Both answers come from one number, L²/α. For the 1 m copper rod it is 1/(1.1 × 10⁻⁴) ≈ 9,100 s, about 2.5 hours. The decay times above are fractions of it: π² ≈ 10 times shorter for the ice-water rod, and 4π² ≈ 40 times shorter for the insulated rod, whose slowest remaining pattern is a full cosine wave. The scale grows with the square of the length. A 10 cm copper rod has L²/α ≈ 91 s, one hundred times shorter. A 1 m steel rod needs about 23 hours.

## A note on history

Joseph Fourier worked out this theory as prefect of the Isère department in Grenoble, a post Napoleon gave him in 1802. In December 1807 he presented a memoir on the propagation of heat to the Institut de France. Lagrange, one of the examiners, objected to Fourier's claim that an arbitrary function could be written as a series of sines and cosines. Fourier won the Institut's 1811 prize competition on the subject, but the jury still criticised his rigour. His book Théorie analytique de la chaleur appeared in 1822, and the series Lagrange doubted now carry Fourier's name.
