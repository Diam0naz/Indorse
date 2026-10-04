/**
 * lib/program — on-chain client for the Indorse program.
 *
 * Everything here is driven by the IDL copy in `lib/idl/` (`npm run idl:sync`),
 * so a program change flows through one sync rather than scattered constants:
 *
 *   idl.ts         IDL accessors, discriminators, name mapping
 *   codec.ts       borsh encode/decode for instruction args and account data
 *   pdas.ts        PDA helpers mirroring the program's seed constraints
 *   instruction.ts kit `Instruction` builder (roles + fixed addresses from IDL)
 *   rpc.ts         account reads (discriminator-checked, codec-decoded)
 *   use-program-rpc.ts  endpoint-bound RPC for the current network preference
 */

export * from './idl'
export * from './codec'
export * from './pdas'
export * from './instruction'
export * from './rpc'
export * from './use-program-rpc'
