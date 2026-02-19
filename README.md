# Vibecoding - Clavier musical

Application web statique qui transforme le clavier ordinateur en mini synthétiseur.

## Fonctionnalités

- 5 instruments sélectionnables : piano, guitare, synthé, basse, batterie.
- Mapping clavier fixe :
  - **Touches blanches**: `A S D F G H J K L`
  - **Touches noires**: `Q W E R T Y U I O P`
- Enregistrement d'une session (du début à la fin), avec export:
  - MIDI (`.mid`)
  - WAV (`.wav`)
- Schéma visuel statique des correspondances touches/notes.
- Aucun affichage dynamique pendant le jeu, uniquement un retour sonore.

## Lancer localement

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.
