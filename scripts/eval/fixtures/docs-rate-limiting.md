# Rate limiting

Every API key has a request budget. The budget is a token bucket: the bucket holds at most 600 requests, refills at 10 requests per second, and each request takes one token. A request that finds the bucket empty is refused with status 429 and a Retry-After header in seconds.

## Limits by endpoint

Read endpoints share the key's bucket. Write endpoints have their own bucket of 120 requests refilling at 2 per second, because a write costs more to serve than a read. Search endpoints count as 5 tokens each: a search is a read that fans out to several shards.

## Handling 429

Do not retry at once. Read the Retry-After header and wait at least that long. If your client retries without waiting, every retry drains the bucket further, and the refused requests count against a second limit: a key that receives 1,000 refusals in an hour is suspended for 15 minutes.

```
async function call(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
  if (res.status === 429) {
    const wait = Number(res.headers.get("Retry-After") ?? "1");
    await sleep(wait * 1000);
    return call(url);
  }
  return res;
}
```

## Batching

- A batch request of up to 50 items takes 1 token, not 50.
- Batches are the cheapest way to read many objects: 50 reads cost 50 tokens as single requests and 1 token as a batch.
- Writes cannot be batched.

## Headers

Every response carries three headers: X-RateLimit-Limit (the bucket size), X-RateLimit-Remaining (tokens left), and X-RateLimit-Reset (seconds until the bucket is full). Read X-RateLimit-Remaining before a burst of requests: when it is below 50, spread the burst over several seconds.

## Raising the limit

Limits are per key, not per account. An account can hold up to 20 keys, and keys do not share buckets, so a client with several independent workloads gets more throughput by giving each workload its own key. A key's bucket size can be raised to 6,000 requests on request; the refill rate stays at 10 per second, so a larger bucket lets you burst longer, not faster.
