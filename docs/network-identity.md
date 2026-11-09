# Network identity verification

A chain ID alone is not a unique network identity. Integrators that require stronger network binding should verify both the expected chain ID and the genesis block hash against a trusted chain specification obtained independently of the RPC endpoint being checked.

The helper in `src/integration/network-identity.ts` is read-only and fails closed:
- `unconfigured`: no valid trusted genesis hash was supplied;
- `wrong-chain`: the observed chain ID differs;
- `genesis-mismatch`: the genesis block is absent or its hash differs;
- `unavailable`: the RPC read failed;
- `verified`: both configured values match.

The helper does not invent or embed a genesis hash. The expected value must be independently confirmed by maintainers and documented before production integrations rely on it. A matching genesis hash strengthens network identification but does not prove that the RPC provider is honest for later state queries; critical applications should use independent providers or cross-check observations.
