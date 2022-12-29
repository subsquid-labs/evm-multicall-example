import {BatchHandlerContext, BatchProcessorItem, EvmBatchProcessor, EvmBlock} from '@subsquid/evm-processor'
import {LogItem} from '@subsquid/evm-processor/lib/interfaces/dataSelection'
import {Store, TypeormDatabase} from '@subsquid/typeorm-store'
import {In} from 'typeorm'
import {Owner, Token, Transfer} from './model'
import {BigNumber} from 'ethers'
import assert from 'assert'

import * as erc721 from './abi/erc721'
import {Multicall} from './abi/multicall'

export const CONTRACT_ADDRESS = '0xac5c7493036de60e63eb81c5e9a440b42f47ebf5'
export const MULTICALL_ADDRESS = '0x5ba1e12693dc8f9c48aad8770482f4739beed696'

let database = new TypeormDatabase()
let processor = new EvmBatchProcessor()
    .setDataSource({
        archive: 'https://eth.archive.subsquid.io',
        chain: 'https://rpc.ankr.com/eth',
    })
    .setBlockRange({
        from: 15_584_000 ,
    })
    .addLog(CONTRACT_ADDRESS, {
        filter: [[erc721.events.Transfer.topic]],
        data: {
            evmLog: {
                topics: true,
                data: true,
            },
            transaction: {
                hash: true,
            },
        },
    })

type Item = BatchProcessorItem<typeof processor>
type Context = BatchHandlerContext<Store, Item>

processor.run(database, async (ctx) => {
    let transfersData: TransferEventData[] = []

    for (let block of ctx.blocks) {
        for (let item of block.items) {
            if (item.kind !== 'evmLog') continue

            if (item.evmLog.topics[0] === erc721.events.Transfer.topic) {
                transfersData.push(handleTransfer(ctx, block.header, item))
            }
        }
    }

    await saveTransfers(ctx, transfersData)
})

interface TransferEventData {
    id: string
    blockNumber: number
    timestamp: Date
    txHash: string
    from: string
    to: string
    tokenIndex: bigint
}

function handleTransfer(
    ctx: Context,
    block: EvmBlock,
    item: LogItem<{evmLog: {topics: true; data: true}; transaction: {hash: true}}>
): TransferEventData {
    let {from, to, tokenId} = erc721.events.Transfer.decode(item.evmLog)

    let transfer: TransferEventData = {
        id: item.evmLog.id,
        tokenIndex: tokenId.toBigInt(),
        from,
        to,
        timestamp: new Date(block.timestamp),
        blockNumber: block.height,
        txHash: item.transaction.hash,
    }

    return transfer
}

async function saveTransfers(ctx: Context, transfersData: TransferEventData[]) {
    let tokensIds: Set<string> = new Set()
    let ownersIds: Set<string> = new Set()

    for (let transferData of transfersData) {
        tokensIds.add(transferData.tokenIndex.toString())
        ownersIds.add(transferData.from)
        ownersIds.add(transferData.to)
    }

    let transfers: Transfer[] = []

    let tokens = await ctx.store.findBy(Token, {id: In([...tokensIds])}).then((q) => new Map(q.map((i) => [i.id, i])))
    let owners = await ctx.store.findBy(Owner, {id: In([...ownersIds])}).then((q) => new Map(q.map((i) => [i.id, i])))

    let newTokens = await initTokens(
        ctx,
        last(ctx.blocks).header,
        Array.from(tokensIds).filter((t) => !tokens.has(t))
    )
    newTokens.forEach((t) => tokens.set(t.id, t))

    for (let transferData of transfersData) {
        let from = owners.get(transferData.from)
        if (from == null) {
            from = new Owner({id: transferData.from})
            owners.set(from.id, from)
        }

        let to = owners.get(transferData.to)
        if (to == null) {
            to = new Owner({id: transferData.to})
            owners.set(to.id, to)
        }

        let tokenId = transferData.tokenIndex.toString()

        let token = tokens.get(tokenId)
        assert(token != null)
        token.owner = to

        let {id, blockNumber, txHash, timestamp} = transferData

        let transfer = new Transfer({
            id,
            blockNumber,
            timestamp,
            txHash,
            from,
            to,
            token,
        })

        transfers.push(transfer)
    }

    await ctx.store.save([...owners.values()])
    await ctx.store.save([...tokens.values()])
    await ctx.store.save(transfers)
}

async function initTokens(ctx: Context, block: EvmBlock, tokenIds: string[]) {
    let contract = new Multicall(ctx, block, MULTICALL_ADDRESS)

    let tokenURIs = await contract
        .tryAggregate(
            erc721.functions.tokenURI,
            CONTRACT_ADDRESS,
            tokenIds.map((id) => [BigNumber.from(id)]),
            1000 // to prevent timeout we will use paggination
        )
        .then((rs) => rs.map((r) => (r.success ? r.value : 'unknown')))

    let res: Token[] = new Array(tokenIds.length)
    for (let i = 0; i < tokenIds.length; i++) {
        res[i] = new Token({
            id: tokenIds[i],
            uri: tokenURIs[i],
            index: BigInt(tokenIds[i]),
        })
    }

    return res
}

function last<T>(arr: T[]): T {
    assert(arr.length > 0)
    return arr[arr.length - 1]
}
