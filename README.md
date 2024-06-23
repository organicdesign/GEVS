# Graph Enhanced Vector Store

Graph enhanced vector store for RAG using knowledge graphs and vector stores.

## Table of Contents

- [Preface](#preface)
- [Getting Started](#getting-started)
- [Vector Stores](#vector-stores)
  - [Chunking](#chunking)
  - [Questions/Answers Prompting](#questions-answers-prompting)
- [Knowledge Graphs](#knowledge-graphs)
  - [Conceptual Understanding](#conceptual-understanding)
  - [Entity Extraction](#entity-extraction)
  - [Weighting Entities](#weighting-entities)
  - [Graph Sanity](#graph-sanity)
- [The Process](#the-process)
  - [Knowledge Processing](#knowledge-processing)
  - [Querying](#querying)
- [Long Context Windows](#long-context-windows)

## Preface

To make open source LLM models work better, access to up-to-date information from diverse sources, including private ones currently absent from training data, is essential. Until long context windows can be properly handled, techniques like Retrieval-Augmented Generation (RAG) are necessary. Unfortunately, vector stores, advertised as a magic solution, have fallen short of expectations in practice. Therefore, significantly improving basic RAG methods is crucial to make them useful.

This document has instuctions for running the provided examples and explanations on how the graph enhanced vector store works and why it produces better results.

## Getting Started

I have added a couple examples on how to use this system to make it easier to understand and get started with. The examples require docker to run.

First you will need to start Chroma and Neo4j:

```
docker compose -f compose.neo4j.yaml -f compose.chroma.yaml up -d
```

Then you will need some data to add to the vector store & graph database, this example fetches and parses data from a URL:

```
URL="https://en.wikipedia.org/wiki/Dinosaur" docker compose -f compose.embed-url.yaml up
```

Now that we have added some data you can use the enhanced query system to get more accurate information on the data you have added:

```
QUERY="What is a T-REX?" docker compose -f compose.query.yaml up
```

You re-run the last two commands with different `URL` and `QUERY` environment variables.

## Vector Stores

Vector stores work of embeddings which are supposed to capture the semantic essence of the prompt, this is quite error prone and fails very poorly in Q/A senarios.

### Chunking

Chunk sizes are an important factor to consider when embedding text which needs to be tuned to your specific data and use case to provide better perfomance. When chunking one needs to consider if the information needed to be provided is typically contained in single sentences or paragraphs. If you have content that takes paragraphs to explain complex concepts then you will find that small chunk sizes will cause halucinations and generally go in the wrong direction. Alternatively if large chunk sizes are used and small facts are queried then you end up two potential problems, first is that it returns more garabge text and has a "needle in a haystack" problem in the result; the second problem is that if there are many facts related to prompt that are in different sections of the text then you have less of them returned.

To properly tune this chunk size parameter you need a specific use case, data and resources to create the metrics for it. This can be fustrating when you have a general use case and somewhat arbitrary data to query over, in this case I would lean toward larger chunk sizes.

### Questions/Answers Prompting

The embedding of a question is often far different that the embedding of text containing the answer, for example compare the following texts:

- (Query) What is X?
- (Embedding \#1) What is Y?
- (Embedding \#2) X is equal to Z.
- (Embedding \#3) X is similar to W.

The first embedding holds closer semantic simularity* to the query than the others despite the second one holding the information needed to answer the query and the third holding relevant information.

Why does this happen when the query is for 'X' and the first embedding has no reference to 'X'? This happens because it's not only the subject of the question that is embedded but the whole question, I tend to think of this simularity search as a text search for something that "sounds like" the query. (Note that I do not mean phonetically sounds like but structually sounding similar.)

To perform better queries, one trick we can perform is to refrase the question as a partial answer make the question "sound like" the result we are actually after:

- (Query) X is a

Now we get embedding \#2 or \#3 depending on the model.

\* Tested on Nomic Embed V1.5, MXBAI Embed Large V1 335M and Snowflake Arctic Embed 335M

## Knowledge Graphs

### Conceptual Understanding

Knowledge graphs excell at linking entities with relationships, we can utilize a knowledge graph to factually describe how entities relate to each other which if provided to the prompt then we can provide more factual answers, for example consider this prompt:

```
Prompt:
X is a child of Y; X is Z; X is similar to W;

How does W relate to Y?

llama3-70b:
...
W is probably a sibling or relative of Y.
```

Augmenting this small amount of information at the start provides some conceptual understanding of the entities considered despite the clear lack of any actual definition of them.

Augmenting a prompt like this can largely improve the response of the prompt.

### Entity Extraction

Knowledge graphs can get very large quite quickly and manually forming one from text is labor intensive, however we can use a large language model to extract entities from text along with the relationships to automate the creation of a knowledge graph. We can prompt the model to follow a specific structure and parse the response to create entities and relationships in a graph database. This requires a large model that is "intelligent" enough to extract them in the proper format - I have found that llama3 70b meets the necessary requirements.

When extracting entities one needs to once again consider the chunk sizes of the text it is extracting from, too large and the models tend to forget the formatting instructions or fail to perform a comprehensive extraction; if the chunks are too small the models can get overly specific on the extraction.

### Weighting Entities

When we extract the entities we can ask the LLM to also measure the emphasis on the entities and relationships. The LLM's are typically not precises enough to measure anything more than 1 significant figure, so asking it to generate a single digit number that can be processed into a percentage is good approach. When we store the entities and relationships in the graph we want to update 2 different metrics, the first being a count of the entity we are adding - simply increment it and the second being the a sum of the recipricals of the emphasis - get the reciprical of the emphasis value generated by the LLM and add it to the metric. Keeping track of both the count and reciprical sum means at a later time we can calulate the harmonic mean for each entitiy and relationship allowing us to weight them in a way that both considers the emphasis for each occurance as well as the frequency that entity occurs.

### Graph Sanity

One of the issues with entity extraction is that sometimes the same entities can be refered to by different names such as "Arthur Koestler" and "Koestler". This can cause problems with the graph since we now have two different nodes for the same identity; this means if we query the graph for "Koestler" we are missing out on the relationships & information associated with the node "Arthur Koestler" and vice verca.

One option I have tried is to search for similar nodes and get the LLM to check if one of the existing nodes is refering to the same thing, this turned out to have more problems than it help solve - it wasn't always successful in finding the right node to reuse and sometimes it would halucinate and cause corruption in my graph. This might be more doable with "smarter" LLMs but at the moment it is too difficult to handle properly.

The solution I arrived at was to not worry too much about graph sanity but embed* each node and relationship into a vector store and get a group of related nodes when querying - this allows us to get not only the nodes directly referenced but other similar nodes in the graph to get more complete search.

\* You will need to use an embedding model that distributes different entities well while being fairly good at clustering like entities.

## The Process

### Knowledge Processing

The first thing we need to have our knowledge processed, this involves to separate processes - embedding and graphing. The embedding stage is the typical process of chunking and embedding into a vector store using your favourite embedding model. The graphing state invloves chunking the text, performing entity extraction on those chunks then adding those extracted entities and relationships to both a graph database and a vector store (different from the ebedding vector store).

### Querying

Once we have some knowledge processed we have a series of steps to take to perform a good query over our data:

1. Perform entity extraction on the prompt.
2. Search our graph vector store for the extracted entities.
3. For each of the found entities search the graph and get the relationships with the highest strengths - each strength being the harmonic mean calculated from the emphasis values.
4. Feed the found entities and relationships to the LLM and get it to generate a paragraph (or sentence(s) if your chunk size is smaller) using the entities and relationships; instruct the model to make stuff up (educated halucination) if it doesn't have knowledge on the entities and relationships it is fed. Note that the accuracy of the generated paragraph isn't very important here only that we end up with something looking like the chunk we are searching, generating it from factual entities and relationships helps greatly with the accuracy of the search in the next step.
5. Take that generated paragraph and search the embedding vector store.
6. Feed the vector store chunks and entity/relationship information to the LLM with the original prompt for answer generation.

## Long Context Windows

In the future we might have access to very long context windows that can hold our entire knowledge base, in which case RAG (and this method) would become redundant.

You might wonder how long context windows could ever efficiently be loaded from a large knowledge base since the model would still have to load and process the data which could take a lot of processing power meaning something like RAG would still be needed to filter the data to reduce processing time/space. I think the way to look at long context windows is to think of them as a database that persists to disk - you no longer need to fetch your data and store it in a vector store or graph database, you just have the model process it and save the context window to disk. The only processing time needed would be to load the context into memory along with the model which doesn't take too long. In time this processing time will reduce due to better hardware and better algorithims.

Until long context windows have reached a desirable state and are accessable we need a process such as the one described in this document that allows for access to a larger knowledge base.
