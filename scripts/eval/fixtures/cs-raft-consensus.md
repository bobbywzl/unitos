# Raft: Consensus You Can Understand

Raft lets a cluster of servers agree on one sequence of commands even when some of them crash. Diego Ongaro and John Ousterhout of Stanford published it in 2014 with one explicit goal: to be easier to understand than Paxos. This article states the problem, walks through Raft's roles and its log, and then comes back to the hardest part of the problem.

## The problem

Take five servers, each keeping a copy of the same key-value store. If every server applies the same commands in the same order, the copies stay identical. The commands are kept in a replicated log, and the servers must agree on which command sits at each position. Servers crash and restart, and messages between them are delayed or lost. Raft keeps working as long as a majority is up: with five servers, any three are enough, so the cluster survives two failures.

Raft makes one server the leader, which decides the order of commands. That moves the difficulty to elections. When the leader crashes, the others must choose a new one, and each server may vote only once per election. If two servers stand for election at the same moment, the votes split, no one gets a majority, and the election fails. If both try again at the same moment, the votes split again, and the cluster can stay without a leader indefinitely. This is the split-vote problem.

## Roles and transitions

Each server is in one of three roles: follower, candidate, or leader. Time is divided into numbered terms; each term begins with an election and has at most one leader. The leader sends heartbeats, empty AppendEntries messages, to every follower at a regular interval, for example every 50 ms. Each follower has an election timeout, a random duration between 150 and 300 ms. If a follower hears nothing from a leader before its timeout runs out, it becomes a candidate: it increments the term, votes for itself, and sends a RequestVote message to every other server. A server grants one vote per term, to the first candidate that asks, provided the candidate's log is at least as up to date as its own.

- Follower to candidate: the election timeout runs out with no message from a leader.
- Candidate to leader: the candidate receives votes from a majority of the servers.
- Candidate to follower: the candidate hears from a leader whose term is at least its own.
- Candidate to candidate: the election timeout runs out with no winner, and a new term starts.
- Leader to follower: the leader sees a message with a higher term than its own.

## Log replication

A client sends a command to the leader, and the leader appends it to its log as a new entry marked with the current term. The leader then sends AppendEntries with the entry to every follower in parallel. The message also carries the index and term of the entry before it; a follower accepts only if its log matches there, and otherwise the leader resends from further back until the logs agree. When a majority, the leader and two followers out of five, have stored the entry, the leader marks it committed, applies it to its state machine, and returns the result to the client. The followers learn of the commit from the next AppendEntries and apply the entry too.

## Why randomized timeouts end split votes

The randomized election timeout is Raft's answer to the split-vote problem. Each follower draws its timeout at random between 150 and 300 ms, so one follower usually times out well before the others. It becomes a candidate, collects a majority, and sends its first heartbeat before any other timeout runs out, so no second candidate appears. A vote splits only when two timeouts land within a few milliseconds of each other, the time one round of messages takes. Then each candidate draws a fresh random timeout, and the next round almost always has one early candidate. This works only if sending a message to all servers, typically 0.5 to 20 ms, is much faster than the election timeout.

## Raft and Paxos

The classic alternative is Paxos, which Leslie Lamport described in a paper published in 1998. Both algorithms need a majority, so 2f + 1 servers survive f crashes. Basic Paxos agrees on a single value; its extension to a whole log, Multi-Paxos, was never fully specified, so each implementation filled the gaps its own way. Raft splits consensus into three parts, leader election, log replication, and safety, and gives the leader full control of the log: entries flow only from the leader to the followers. In a study with 43 students at Stanford and Berkeley, 33 answered questions about Raft better than questions about Paxos after learning both.
