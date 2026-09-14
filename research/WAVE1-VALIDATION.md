# Première phase réelle — 14 septembre 2026

Observation en lecture seule vers 08:00 UTC. Données : wave1-observed.json.

- Premier bloc à partir de l'ouverture : 60937607, timestamp 1789344001 (ouverture +1 seconde).
- 508 transactions émettant MintSuccess pour Yakkamon dans les 200 premiers blocs, soit environ 6 min 40. Décodage détaillé des 20 premières transactions réussies seulement.
- Même launchpad, execute puis mintAllowList, stageType 2, stageIndex 1, quantité 1 et valeur 0.
- Premier mint : 0x28a5dc1506100a3344c8d0081e45083685dad770abaa7c84b3766b82033ec019. Options isMintAllPossible=false et extraData=0x, identiques au bot. D'autres utilisent true et 0x00 ; aucun changement nécessaire pour notre quantité fixe de 1. Le bot utilisera stageIndex 2 pour OG.
- Gas consommé des 20 premières : 268 870 à 285 105, médiane 269 012.
- Priorité déclarée : 1 à 550 Gwei. Prix effectif : 21 à 570 Gwei.
- Frais d'exécution gasUsed × effectiveGasPrice : 0,00564627 à 0,16250985 RON, hors frais supplémentaires L1/opérateur.
- Le plancher actuel de priorité du bot (10 000 Gwei) dépasse le maximum de cet échantillon d'environ 18 fois. Aucun relèvement supplémentaire effectué.

Précontrôle OG refait : contrats conformes, wallet éligible, prix nul, quota 1, stock OG 3 000, nonce 32 sans transaction pending. Les deux RPC configurés sont sains. Résultat de simulation pending attendu : phase non commencée. Voir og-latest-preflight.json pour la simulation future et l'état d'activation.

Cet échantillon des premiers succès ne mesure ni les échecs ni toute la concurrence. La phase OG peut être plus disputée. Aucun envoi réel ni activation du bot effectué.
