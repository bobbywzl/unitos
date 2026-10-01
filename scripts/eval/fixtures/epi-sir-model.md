# The SIR Model: How an Epidemic Rises and Falls

Why does an epidemic peak and then fade while many people are still uninfected? The SIR model, published by William Kermack and Anderson McKendrick in 1927, answers with three numbers that change over time and two rates that drive them. This explainer builds the model, runs it on a town of 10,000 people, uses it to judge vaccination, and ends with what it leaves out.

## Three compartments

The model sorts a population of N people into three compartments. S is the number of susceptible people, who can still catch the disease. I is the number of infected people, who are also infectious. R is the number of removed people, who have recovered with immunity or died; either way they no longer take part. People flow in one direction only: from S to I when they are infected, and from I to R when they recover. Nobody is born, nobody moves away, and S + I + R = N at all times.

## The equations

The flows are three differential equations: dS/dt = −βSI/N, dI/dt = βSI/N − γI, and dR/dt = γI. The transmission rate β is the number of contacts a person has per day times the chance that a contact between an infected and a susceptible person passes the disease on. The term βSI/N counts new infections per day: each of the I infected people makes β contacts a day, and a fraction S/N of those contacts are with susceptible people. The recovery rate γ is the fraction of infected people who recover each day, so 1/γ is the average number of days a person stays infectious. The three right-hand sides add up to zero, which is why N stays constant.

The basic reproduction number is R0 = β/γ: the number of people one infected person infects in a population where everyone is susceptible. The number of infected people grows while βS/N is greater than γ, that is, while R0 · S/N is greater than 1. As the epidemic uses up susceptible people, S/N falls, and the moment it drops to 1/R0 the number of infected people stops growing. That point defines the herd immunity threshold: the epidemic cannot grow once a fraction 1 − 1/R0 of the population is immune.

## A worked example

Take a town of N = 10,000 with 10 infected people and 9,990 susceptible, β = 0.3 per day, and γ = 0.1 per day, so a person is infectious for 10 days on average and R0 = 3. At first nearly everyone is susceptible and the infected count grows at a rate of β − γ = 0.2 per day, doubling about every 3.5 days: 10 people on day 0, about 490 on day 20, about 2,060 on day 30. The herd immunity threshold is 1 − 1/3, two thirds of the town. The curve of I peaks on about day 38, when S falls to 3,333, with about 3,000 people infected at the same time. It then falls more slowly than it rose: about 2,000 on day 50, 1,000 on day 60, and 40 on day 100. The epidemic does not stop at the threshold. The 3,000 people infected at the peak keep infecting others on the way down, and by the end about 9,400 people, 94 percent of the town, have been infected. Only about 600 never catch it.

## Vaccination

Vaccination moves people from S straight to R before the outbreak starts, without their passing through I. In the town above, vaccinating 5,000 people in advance leaves 4,990 susceptible, so each early case infects R0 · S/N ≈ 1.5 people instead of 3. The epidemic still happens, but it is slower and smaller: the peak comes on about day 100 with about 320 people infected at once, and about 2,900 are infected in all, against 9,400 without vaccination. Vaccinating 7,000 people puts the town past the two-thirds threshold before the outbreak starts. Each case then infects fewer than one other person, and the first 10 cases lead to fewer than 100 infections in all before the outbreak dies out.

## Limits of the model

The model assumes homogeneous mixing: every person is equally likely to meet every other person, so a household, a school, and a village far away all count the same. It keeps β fixed, although people change their behaviour when cases rise and many diseases spread better in winter. It has no latent period between infection and infectiousness; the SEIR model adds a fourth compartment, E, for that. It assumes immunity lasts forever and that the population is closed. And it is deterministic: with 10 cases it predicts a smooth curve, while a real outbreak that starts from a few cases can die out by chance.
