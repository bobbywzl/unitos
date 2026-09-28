# Quicksort

Quicksort sorts an array by splitting it around one element and then sorting the two parts. Tony Hoare invented it in 1959 and published it in 1961. This section builds the algorithm from its one real step, partition, then measures its running time, finds the input that breaks it, and repairs it.

## The partition step

Partition takes a subarray A[lo..hi] and one of its elements, the pivot, and rearranges the subarray so that every element no greater than the pivot comes before it and every larger element comes after it. The pivot then sits in its final sorted position. The Lomuto scheme takes the last element, A[hi], as the pivot. A boundary index i starts at lo − 1, and a second index j scans from lo to hi − 1. At every step, A[lo..i] holds elements no greater than the pivot and A[i+1..j−1] holds larger ones. When A[j] is no greater than the pivot, i moves one place right and A[i] and A[j] swap. When A[j] is larger, nothing happens. A last swap puts the pivot between the two regions.

Take the array [7, 2, 9, 4, 3, 8, 5], with positions 0 to 6. The pivot is the last element, 5, and i starts at −1. The scan runs j from 0 to 5:

- j = 0: 7 is greater than 5; nothing happens.
- j = 1: 2 is not greater than 5; i becomes 0 and A[0] swaps with A[1]: [2, 7, 9, 4, 3, 8, 5].
- j = 2: 9 is greater than 5; nothing happens.
- j = 3: 4 is not greater than 5; i becomes 1 and A[1] swaps with A[3]: [2, 4, 9, 7, 3, 8, 5].
- j = 4: 3 is not greater than 5; i becomes 2 and A[2] swaps with A[4]: [2, 4, 3, 7, 9, 8, 5].
- j = 5: 8 is greater than 5; nothing happens.
- Last swap: A[3] swaps with the pivot A[6]: [2, 4, 3, 5, 9, 8, 7].

The pivot 5 now sits at position 3, its place in the sorted array. The elements to its left, 2, 4, and 3, are all smaller, and the elements to its right, 9, 8, and 7, are all larger. The scan made six comparisons: partition of n elements always takes n − 1.

## Recursion on both sides

After partition returns the pivot's position p, quicksort calls itself on A[lo..p−1] and on A[p+1..hi]. A subarray of zero or one element is already sorted and ends the recursion. In our example the left part [2, 4, 3] is partitioned around 3 and becomes [2, 3, 4]. The right part [9, 8, 7] is partitioned around 7, the smallest of the three, so 7 moves to the front and every other element lands on its right: [7, 8, 9]. One more partition of [8, 9] finishes the job: [2, 3, 4, 5, 7, 8, 9]. The split of [9, 8, 7] was as unbalanced as a split can be, and the next section shows why that matters.

## Running time

Each level of recursion partitions subarrays that together hold at most n elements, so a level costs O(n) comparisons. If every pivot splits its subarray in half, there are about log₂ n levels, and the total is O(n log n). On a random ordering of the input, pivots are good enough on average: quicksort makes about 2n ln n ≈ 1.39 n log₂ n comparisons, about 13,800 for n = 1,000.

The worst case is the unbalanced split of [9, 8, 7], repeated at every level. Give Lomuto quicksort an array that is already sorted, [1, 2, 3, ..., n]. The last element is always the largest, so every partition puts all other elements on its left, and each level peels off one element. There are n levels, and the comparisons add up to (n − 1) + (n − 2) + ... + 1 = n(n − 1)/2: for n = 1,000, 499,500 comparisons, 36 times the average, with recursion 1,000 calls deep. Running time is O(n²). Sorted inputs are common in practice.

## Randomized pivot

The fix is to stop letting the input choose the pivot. Before each partition, pick a position between lo and hi uniformly at random, swap that element with A[hi], and run the Lomuto scheme unchanged. Now no input is bad: on every array, sorted ones included, the expected number of comparisons is about 2n ln n. The O(n²) case still exists but needs a long run of unlucky random choices. A common alternative, the median of three, takes the median of the first, middle, and last elements as the pivot. It handles sorted input without random numbers, but an adversary who knows the rule can still build an input that forces quadratic time.
