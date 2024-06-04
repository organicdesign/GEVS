# Graph Vector Store

Improved RAG using knowledge graphs and vector stores.

## Preface

To make open source LLM models work better, access to up-to-date information from diverse sources, including private ones currently absent from training data, is essential. Until long context windows can be properly handled, techniques like Retrieval-Augmented Generation (RAG) are necessary. Unfortunately, vector stores, advertised as a magic solution, have fallen short of expectations in practice. Therefore, significantly improving basic RAG methods is crucial to make them useful.

## Vector Stores

Vector stores work of embeddings which are supposed to capture the semantic essence of the prompt, this is quite error prone and fails very poorly in Q/A senarios.

### Chunking

Chunk sizes are an important factor to consider when embedding text which needs to be tuned to your specific data and use case to provide better perfomance. When chunking one needs to consider if the information needed to be provided is typically contained in single sentences or paragraphs. If you have content that takes paragraphs to explain complex concepts then you will find that small chunk sizes will cause halucinations and generally go in the wrong direction. Alternatively if large chunk sizes are used and small facts are queried then you end up two potential problems, first is that it returns more garabge text and has a "needle in a haystack" problem in the result; the second problem is that if there are many facts related to prompt that are in different sections of the text then you have less of them returned.

To properly tune this chunk size parameter you need a specific use case, data and resources to create the metrics for it. This can be fustrating when you have a general use case and somewhat arbitrary data to query over, in this case I would lean toward larger chunk sizes.

### Questions/Answers Prompting

The embedding of a question is often far different that the embedding of text containing the answer, for example compare the following texts:

- (Query) What is X?
- (Embedding #1) What is Y?
- (Embedding #2) X is equal to Z.
- (Embedding #3) X is similar to W.

The first embedding holds closer semantic simularity* to the query than the others despite the second one holding the information needed to answer the query and the third holding relevant information.

Why does this happen when the query is for 'X' and the first embedding has no reference to 'X'? This happens because it's not only the subject of the question that is embedded but the whole question, I tend to think of this simularity search as a text search for something that "sounds like" the query. (Note that I do not mean phonetically sounds like but structually sounding similar.)

To perform better queries, one trick we can perform is to refrase the question as a partial answer make the question "sound like" the result we are actually after:

- (Query) X is a

Now we get embedding #2 or #3 depending on the model.

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

### Graph Sanity

One of the issues with entity extraction is that sometimes the same entities can be refered to by different names such as "Arthur Koestler" and "Koestler". This can cause problems with the graph since we now have two different nodes for the same identity; this means if we query the graph for "Koestler" we are missing out on the relationships & information associated with the node "Arthur Koestler" and vice verca.

One option I have tried is to search for similar nodes and get the LLM to check if one of the existing nodes is refering to the same thing, this turned out to have more problems than it help solve - it wasn't always successful in finding the right node to reuse and sometimes it would halucinate and cause corruption in my graph. This might be more doable with "smarter" LLMs but at the moment it is too difficult to handle properly.

The solution I arrived at was to not worry too much about graph sanity but embed each node and relationship into a vector store and get a group of related nodes when querying - this allows us to get not only the nodes directly referenced but other similar nodes in the graph to get more complete search.
