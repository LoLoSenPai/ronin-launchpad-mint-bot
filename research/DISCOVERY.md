# Yakkamon — découverte vérifiée le 12 septembre 2026

Les paramètres ci-dessous ont été lus sur Ronin mainnet (chain ID 2020). La page du marketplace reste protégée par Cloudflare dans l'environnement de recherche. L'identification repose sur le contrat vérifié, son autorisation de mint et la configuration on-chain correspondant aux six phases de la capture.

## Contrats et appel

| Élément | Valeur |
| --- | --- |
| NFT Yakkamon | `0x6d1bc5247ca99D917d91EC52Dbbb5EF6c2435107` |
| Proxy MavisLaunchpad, destination de la transaction | `0xa8e9fdf57bbd991c3f494273198606632769db99` |
| Implémentation du proxy | `0x36e83fa9741a794d888fEdceA4d5De522D003368` |
| Logique ALLOWED_LIST | `0x4a9Db5f7aDE442B368bb6F4aBAbf1a2214B8BC59` |
| Fonction extérieure | `execute(uint8,bytes)`, sélecteur `0xfb4d364c` |
| Fonction intérieure | `mintAllowList((address,address,uint256,bool,uint8,bytes))`, sélecteur `0x55110a0c` |
| `stageType` OG | `2` (ALLOWED_LIST) |
| `stageIndex` OG | `2` |
| `extraData` | `0x` : ignoré par `Yakkamon.mintLaunchpad` |
| Destinataire | Adresse éligible, identique au signataire dans ce bot |
| Quantité / mintAll | `1` / `false` |
| Valeur native | `0` |
| Devise de configuration | `0xe514d9DEB7966c8BE0ca922de8a064264eA6bcd4` (WRON), prix zéro |

Le NFT accorde `MINT_ROLE` au proxy. L'autre contrat vérifié nommé Yakkamon, `0x52800Ae331591f7F5Aa27410cAc7F4cD6441eC2e`, est absent de ce launchpad (`ErrNFTContractNotExisted`). Il n'est pas utilisé.

Les ABIs sont copiées des sources vérifiées de l'explorateur ; les empreintes du bytecode sont enregistrées dans `src/launchpad/pins.json`. Le précontrôle vérifie également le slot EIP-1967 du proxy et `getStageLogicsOf([2])`. Une mise à jour du proxy ou de la logique bloque la signature jusqu'à revue.

## Phases lues sur le contrat

Heures Europe/Paris (UTC+2 à ces dates), début inclus, fin exclue.

| Index on-chain | Nom de la capture | Début Paris | Fin Paris | Limite phase |
| --- | --- | --- | --- | --- |
| 1 | Top Trainers | 14 septembre 02:00 | 15 septembre 02:00 | 1 000 |
| 2 | OG Trainers | 15 septembre 02:00 | 16 septembre 02:00 | 3 000 |
| 3 | Ronin Wave | 16 septembre 10:00 | 17 septembre 10:00 | 2 000 |
| 4 | Yakkamon Hunters | 17 septembre 10:00 | 18 septembre 02:00 | 5 000 |
| 5 | Public Trainers | 18 septembre 02:00 | 19 septembre 02:00 | 10 000 |
| 255 | Public Stage | 19 septembre 02:00 | 19 septembre 10:00 | stock global restant |

Supply du launch : 10 000. Toutes les phases affichent un prix de zéro et une limite standard de un par wallet. Les cinq premières sont des ALLOWED_LIST ; Public Trainers reste donc une whitelist malgré son nom. Le stage public utilise le type 1, index 255 ; sa valeur de configuration `maxSupply = 0` ne doit pas être interprétée comme un stock réel de zéro. Le bot ne signe actuellement que pour les phases allowlist 1 à 5.

`allowCumulativeLimit = false` : `getMintedByMinter` lit les mints du wallet dans la phase courante. Pour chaque phase allowlist, le stock disponible vaut le minimum du stock restant de la phase et du stock global restant. Les plafonds des phases ne s'additionnent pas au-delà des 10 000 NFT.

Le nombre de 10 000 wallets concurrents OG vient de l'utilisateur ; le bot ne s'appuie pas sur ce nombre pour calculer le payload.

## Éligibilité et sécurité de paiement

`checkIsEligible(nft, stageIndex, recipient)` lit une mapping on-chain, alimentée par `addAllowUsers`. La logique vérifiée ne demande ni preuve Merkle ni signature serveur pour ALLOWED_LIST. Elle utilise `param.recipient` comme minter. La valeur `extraData` est transmise au NFT, dont le code l'ignore.

`getTierOfUser` peut modifier individuellement prix et limite : le précontrôle le consulte. Un prix non nul bloque le bot, y compris si le prix par défaut de la phase reste nul. Les partages de paiement nuls sont ignorés dans `_handlePayment`, donc aucun transfert ERC20 ni approval n'est nécessaire pour ce mint gratuit.

## Transactions déjà observées

La transaction [`0x11e167…6688f56`](https://explorer.roninchain.com/tx/0x11e167f51064e42c9d18b79d051d0f024272f80d14dd502bd3053c6616688f56) du 11 septembre appelle bien `execute(2, mintAllowList(...))` pour le NFT ci-dessus, stage 2, quantité 1 et `extraData=0x`. Elle est **échouée**, pas un mint réussi. Son paramètre `isMintAllPossible=true` diffère volontairement de celui du bot, qui exige exactement un NFT (`false`).

L'observation des premières réussites de la vague 1 reste à faire à partir du 14 septembre. `pnpm bot observe` décode les événements `MintSuccess`, filtre Yakkamon et enrichit chaque hash avec transaction, receipt et gas. Un scan effectué le 12 septembre n'a trouvé aucun mint réussi dans la fenêtre récente, conformément au lancement à venir.

## Réseau et frais

Documentation officielle : Ronin utilise OP Stack, blocs d'environ 2 s, Flashblocks d'environ 250 ms, chain ID 2020. La lecture réelle du réseau renvoie bien EIP-1559 ; un échantillon du 12 septembre montrait 20 Gwei de base fee. Les calculs utilisent `eth_feeHistory` et un plancher conservateur de priorité de 20 Gwei tiré de la documentation. Le mode race est un choix local (90e percentile, multiplicateur 2), pas un niveau officiel ni une garantie de priorité.

Le RPC officiel répond. Les deux alternatives publiques indiquées par la documentation (`ronin.drpc.org`, `ronin.lgns.net/rpc`) n'ont pas répondu correctement dans cet environnement. Elles sont filtrées par le contrôle de santé. Ajouter un fournisseur indépendant fonctionnel reste souhaitable avant la course.

Les lots JSON-RPC de deux et trois requêtes ont été acceptés ; un lot de cinq a été refusé avec HTTP 400 « Too many requests ». Le transport limite donc les lots à trois, tout en lançant les lectures indépendantes en parallèle.

Malgré la documentation Flashblocks, `eth_simulateV1` sur le RPC officiel renvoie HTTP 400, « Method is not whitelist: eth_simulateV1 ». Le précontrôle signale cette capacité comme indisponible. `eth_call` avec le tag pending fonctionne ; avec un wallet public de la whitelist OG, il renvoie actuellement `ErrStageNotStarted`.

Le GasPriceOracle OP Stack `0x420000000000000000000000000000000000000F` répond à `getL1FeeUpperBound` et `getOperatorFee`. Le bot ajoute quatre fois leur somme au budget d'exécution. **Ce contrôle est un budget d'admission au moment de la signature : le format EIP-1559 ne permet pas de plafonner absolument les frais L1 futurs.** Le code ne promet donc pas une garantie de coût total au niveau du protocole.

## Sources primaires

- [NFT, source vérifiée](https://explorer.roninchain.com/address/0x6d1bc5247ca99D917d91EC52Dbbb5EF6c2435107?tab=contract)
- [Implémentation MavisLaunchpad](https://explorer.roninchain.com/address/0x36e83fa9741a794d888fEdceA4d5De522D003368?tab=contract)
- [AllowlistStageLogic](https://explorer.roninchain.com/address/0x4a9Db5f7aDE442B368bb6F4aBAbf1a2214B8BC59?tab=contract)
- [Informations réseau Ronin](https://docs.roninchain.com/developers/network/)
- [Estimation des frais Ronin](https://docs.roninchain.com/developers/network/eip-1559/gas-suggestion)
- [Flashblocks Ronin](https://docs.roninchain.com/developers/network/flashblocks)
- [Composantes des frais OP Stack](https://docs.optimism.io/op-stack/transactions/fees)
- [Catalogue des ABI roninbuilders](https://github.com/roninbuilders/contracts)

Les réponses brutes et sources Solidity consultées sont conservées localement dans `research/raw/`, exclu de Git. Le rapport du test local est dans `research/fork-validation.json`.
