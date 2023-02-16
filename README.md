[![Open in Gitpod](https://gitpod.io/button/open-in-gitpod.svg)](https://gitpod.io/#https://github.com/subsquid-labs/multicall-example)


# Exosama NFT collection

This sample squid indexes [Exosama NFT](https://etherscan.io/address/0xac5c7493036de60e63eb81c5e9a440b42f47ebf5) transfers on the Ethereum Mainnet by subscribing to the `Transfer` logs. For each new batch, the processor detects the NFTs that have not yet been indexed and populates the metadata calling the contract state (see `initTokens()`). The contract state queries are batched using the [Multicall 
contract](https://etherscan.io/address/0x5ba1e12693dc8f9c48aad8770482f4739beed696) and the `Multicall` facade class generated with `sqd codegen`. Note the `--multicall` flag in the `codegen` command defined in `commands.json`.

One can use this example as a template for scaffolding a new squid project with [`sqd init`](https://docs.subsquid.io/squid-cli/):

```bash
sqd init my-new-squid --template https://github.com/subsquid-labs/multicall-example
```


## Prerequisites

- Node v16.x
- Docker
- [Squid CLI](https://docs.subsquid.io/squid-cli/)

## Running 

Clone the repo and navigate to the root folder.

```bash
npm ci
sqd build
# start the database
sqd up
# starts a long-running ETL and blocks the terminal
sqd process

# starts the GraphQL API server at localhost:4350/graphql
sqd serve
```
