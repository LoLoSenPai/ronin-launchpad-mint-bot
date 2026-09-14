# Validation du 12 septembre 2026

## Réalisé

- `pnpm typecheck` : réussi.
- `pnpm test` : 27 tests réussis (fees, plafond incluant frais supplémentaires, sélecteurs imbriqués, paramètres exacts, données malformées, diffusion parallèle, erreurs ambiguës, état persistant, verrou wallet, receipts/reorg, simulation et désactivation mainnet).
- `pnpm bot status` : chain ID 2020, proxy, implémentation, logique, bytecode, MINT_ROLE, configuration des six phases et supply globale lus avec succès.
- `pnpm bot observe --once` : scan des blocs récents, aucun mint Yakkamon réussi dans cette fenêtre avant le lancement.
- Précontrôle sur une adresse publique témoin issue de `AllowUsersAdded` : éligible OG, prix 0, limite 1, `ErrStageNotStarted` correctement identifié.
- Test sur fork Anvil de Ronin au bloc 60872577, chain ID locale 31337 : simulation avant ouverture refusée ; simulation à l'ouverture réussie ; mint local de 1 NFT réussi ; gas réellement consommé 282605 ; deuxième tentative bloquée par le précontrôle. Voir `fork-validation.json`.

## Non effectué / indisponible

- Aucune signature ni transaction mainnet.
- Pas de clé privée de l'utilisateur ; son adresse, son solde et sa whitelist restent à vérifier.
- Pas de première transaction réussie de vague 1 : ouverture le 14 septembre.
- `eth_simulateV1` bloqué par la whitelist de méthodes du RPC officiel (HTTP 400). Le test avec timestamp futur a été fait uniquement sur la copie locale.
- Un seul endpoint public testé fonctionne depuis cette machine ; les deux alternatives publiques documentées échouent au contrôle de santé.
- RBF désactivé ; aucune preuve empirique de délai de préconfirmation d'une transaction envoyée par ce bot sur Ronin.
- Pas de test de fonctionnement pendant veille/reboot/coupure machine ; l'état est persistant mais le processus doit être maintenu ou relancé.
- Les trois confirmations du moniteur concernent L2 ; la finalité L1 n'est pas attendue par cette version.

Le fork valide l'exécution du contrat à partir d'un état réel et d'un timestamp local modifié. Il ne reproduit pas la compétition du séquenceur, les latences RPC, les frais L1 futurs ni la demande au moment du lancement.

## Mise à jour du 14 septembre — exécution préparée

Les limites historiques ci-dessus sont complétées par WAVE1-VALIDATION.md et RPC-VALIDATION.md : la première vague a été observée et deux RPC fonctionnent. Thirdweb accepte la simulation future.

Le chemin d'exécution prépare désormais contrats, nonce, frais, gas et budget entre T−30 et T−8 s. Validité maximale de 15 s depuis le début des lectures, délai de préparation borné à T−2 s. Le premier eth_call pending réussi parmi les RPC déclenche ensuite signature, sauvegarde durable et diffusion ; une préparation absente ou périmée impose le chemin complet plus lent.

Répétition en lecture seule avec la configuration locale le 14 septembre à 08:17 UTC : staging 2 802 ms, gas avec marge 371 027, budget calculé 3,725111085720781336 RON, nonce 32. Cette durée est déplacée avant l'ouverture ; ce n'est pas une mesure de délai d'inclusion.

Le suivi utilise des lectures indépendantes par RPC, tick 250 ms et une requête en vol par fournisseur. Une préconfirmation n'est pas traitée comme confirmation canonique. Les lectures démarrent sans attendre toutes les réponses de diffusion. Une disparition/réorganisation de reçu réautorise la rediffusion des mêmes octets.

RBF reste désactivé : le dépôt dhasap/nft-mint-agent utilise des remplacements génériques mais ne valide pas Ronin. La méthode op_supportedCapabilities n'est pas accessible sur nos endpoints (officiel HTTP 400, thirdweb -32601), donc aucune garantie de suivi Flashblocks à 250 ms. Sources consultées : https://github.com/dhasap/nft-mint-agent/blob/main/fast-mint.mjs et https://specs.optimism.io/protocol/flashblocks.html.

Le test de fork passe désormais par un proxy local qui n'autorise que des lectures et les espace de 500 ms : les chargements massifs de stockage rencontraient des HTTP 429 sur les RPC publics. Ce proxy n'est pas utilisé par le bot de production.

Validation finale : typecheck réussi ; suite de 40 tests réussie, puis test supplémentaire de non-accumulation des appels sur RPC bloqué réussi (4/4 tests opening). Fork 60952000 : préparation avant ouverture, contrôle pending à l'ouverture, mint local réussi (285 405 gas, 1 NFT), doublon refusé. Mesures locales staging 736 ms et gate 723 ms, non représentatives de l'inclusion mainnet. Rapport détaillé : fork-validation.json. Aucun envoi mainnet et aucune modification d'activation ni de secrets.
