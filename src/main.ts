import {In} from 'typeorm'
import {assertNotNull} from '@subsquid/evm-processor'
import {TypeormDatabase} from '@subsquid/typeorm-store'
import {Block, CONTRACT_ADDRESS, Context, Log, MULTICALL_ADDRESS, Transaction, processor} from './processor'
import * as erc721 from './abi/erc721'
import {Account, Token, Transfer} from './model'
import {Multicall} from './abi/multicall'

processor.run(new TypeormDatabase({supportHotBlocks: true}), async (ctx) => {
    let transfersData: TransferEvent[] = []

    for (let block of ctx.blocks) {
        for (let log of block.logs) {
            if (log.topics[0] === erc721.events.Transfer.topic) {
                transfersData.push(getTransfer(ctx, log))
            }
        }
    }

    await processTransfers(ctx, transfersData)
})

interface TransferEvent {
    id: string
    block: Block
    transaction: Transaction
    from: string
    to: string
    tokenIndex: bigint
}

function getTransfer(ctx: Context, log: Log): TransferEvent {
    let transaction = assertNotNull(log.transaction, 'Missing transaction')

    let event = erc721.events.Transfer.decode(log)

    let from = event.from.toLowerCase()
    let to = event.to.toLowerCase()
    let tokenIndex = event.tokenId

    ctx.log.debug({block: log.block, txHash: transaction.hash}, `Transfer from ${from} to ${to} token ${tokenIndex}`)
    return {
        id: log.id,
        block: log.block,
        transaction,
        tokenIndex,
        from,
        to,
    }
}

async function processTransfers(ctx: Context, transfersData: TransferEvent[]) {
    let tokensIds: Set<string> = new Set()
    let ownersIds: Set<string> = new Set()

    for (let transferData of transfersData) {
        tokensIds.add(transferData.tokenIndex.toString())
        ownersIds.add(transferData.from)
        ownersIds.add(transferData.to)
    }

    let transfers: Transfer[] = []

    let tokens = await ctx.store.findBy(Token, {id: In([...tokensIds])}).then((q) => new Map(q.map((i) => [i.id, i])))
    let owners = await ctx.store.findBy(Account, {id: In([...ownersIds])}).then((q) => new Map(q.map((i) => [i.id, i])))

    let newTokens: Token[] = []
    for (let transferData of transfersData) {
        let from = owners.get(transferData.from)
        if (from == null) {
            from = new Account({id: transferData.from})
            owners.set(from.id, from)
        }

        let to = owners.get(transferData.to)
        if (to == null) {
            to = new Account({id: transferData.to})
            owners.set(to.id, to)
        }

        let tokenId = transferData.tokenIndex.toString()

        let token = tokens.get(tokenId)
        if (token == null) {
            token = new Token({
                id: tokenId,
                index: transferData.tokenIndex,
            })
            tokens.set(token.id, token)
            newTokens.push(token)
        }
        token.owner = to

        let {id, block, transaction} = transferData

        let transfer = new Transfer({
            id,
            blockNumber: block.height,
            timestamp: new Date(block.timestamp),
            txHash: transaction.hash,
            from,
            to,
            token,
        })

        transfers.push(transfer)
    }

    await initTokens(ctx, newTokens)

    await ctx.store.save([...owners.values()])
    await ctx.store.save([...tokens.values()])
    await ctx.store.save(transfers)
}

async function initTokens(ctx: Context, tokens: Token[]) {
    let multicall = new Multicall(ctx, ctx.blocks[ctx.blocks.length - 1].header, MULTICALL_ADDRESS)

    let args = tokens.map((t) => [t.index])
    let uris = await multicall.aggregate(erc721.functions.tokenURI, CONTRACT_ADDRESS, args)

    for (let i = 0; i < tokens.length; i++) {
        tokens[i].uri = uris[i]
    }
}
