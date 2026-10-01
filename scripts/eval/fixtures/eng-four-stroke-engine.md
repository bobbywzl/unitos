# How a Four-Stroke Engine Works

Nearly every car engine that burns fuel turns it into motion in four piston strokes, a cycle Nikolaus Otto first built into a working engine in 1876. This explainer names the parts, walks through the four strokes, explains why compression matters, compares the Diesel engine, and ends with the heavy wheel that keeps the whole cycle turning.

## The parts

A piston slides up and down inside a cylinder. A connecting rod joins the piston to the crankshaft, which turns the up-and-down motion into rotation. The top of the cylinder is closed by the cylinder head, which holds an intake valve, an exhaust valve, and a spark plug. The highest point of the piston's travel is top dead centre, and the lowest is bottom dead centre. One stroke is one trip of the piston between them, which turns the crankshaft half a revolution. A camshaft, driven by the crankshaft at half its speed, opens each valve at the right moment.

## The four strokes

The cycle starts with the piston at top dead centre. In the intake stroke, the intake valve opens and the piston moves down, drawing a mixture of air and fuel into the cylinder; the exhaust valve stays closed. In the compression stroke, both valves close and the piston moves up, squeezing the mixture into a small space at the top of the cylinder. Just before the piston reaches the top, the spark plug fires. In the power stroke, the burning mixture reaches a high pressure and drives the piston down, with both valves still closed; this is the only stroke that pushes the crankshaft. In the exhaust stroke, the exhaust valve opens and the piston moves up again, pushing the burned gas out. Then the intake valve opens and the cycle repeats.

Each stroke turns the crankshaft half a revolution, so one full cycle takes two revolutions, 720 degrees of crank rotation, while the camshaft turns once and opens each valve once. At 3,000 revolutions per minute, each stroke lasts 10 ms, and each cylinder fires 1,500 times a minute, 25 times a second.

## Compression ratio

The compression ratio is the volume of the cylinder with the piston at bottom dead centre divided by the volume with the piston at top dead centre. A typical gasoline engine has a ratio of about 10:1. In a cylinder that sweeps 500 cm³, that leaves a space of about 56 cm³ above the piston at the top, so the mixture is squeezed from about 556 cm³ into 56 cm³. Compressing the mixture before it burns is what makes the engine efficient: the higher the ratio, the more of the fuel's energy becomes work. For an ideal engine the efficiency is 1 − 1/r^0.4, about 60 percent for r = 10; real engines reach about 30 to 40 percent because of heat loss and friction. The ratio cannot rise without limit in a gasoline engine. Compression heats the mixture, and if the ratio is too high for the fuel's octane rating, the mixture ignites on its own before the spark, which is called knock and can damage the engine.

## The Diesel alternative

Rudolf Diesel's engine, first run in 1897, removes the spark plug. In the intake stroke it draws in air only. It compresses that air at a ratio of 16:1 to 20:1, which heats it to well over 500 °C. Near the top of the compression stroke, an injector sprays fuel straight into the hot air, and the fuel ignites on contact. This is compression ignition. The Diesel engine avoids knock because there is no fuel in the cylinder to ignite early, so it can use the higher compression ratio, and the higher ratio makes it more efficient: large truck engines convert over 40 percent of their fuel's energy into work. The cost is weight, because the cylinder and head must withstand much higher pressures.

## Why a flywheel

Of the four strokes, only the power stroke pushes the crankshaft. The other three take energy from it: the intake stroke pulls against the throttle, the exhaust stroke pushes out the gas, and the compression stroke squeezes the mixture, which takes the most. In a one-cylinder engine the crankshaft is driven for only 180 of every 720 degrees, a quarter of the cycle. A flywheel, a heavy disc bolted to the crankshaft, solves this. It stores kinetic energy while the power stroke speeds it up and gives that energy back during the next three strokes, carrying the piston through compression and keeping the crankshaft turning at a nearly even speed. An engine with four cylinders spreads its power strokes out, one every 180 degrees, so its flywheel can be lighter, but it still needs one to smooth the pulses.
