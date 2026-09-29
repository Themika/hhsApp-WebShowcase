# HHS Stroke Protocol Engine

The HHS Stroke Protocol Engine is a browser-based workflow platform for organizing, reviewing, and running configurable stroke-protocol decision paths. It turns complex protocol criteria into a guided, step-by-step experience while giving authorized team members the tools to maintain the underlying protocol without changing application code.

## Project Overview

This project demonstrates the design and implementation of a lightweight clinical workflow application with:

- A guided screening experience for answering protocol questions and progressing through decision branches.
- An administrative editing experience for building and maintaining protocol stages and trial options.
- Role-aware collaboration and cloud synchronization for a shared team workflow.
- Browser and native-device data persistence, import/export, validation, and recovery features.

## Key Features

### Guided Protocol Workflow

- Presents one protocol stage at a time with clear Yes/No actions.
- Routes users through configurable branches, including explicit `No` destinations.
- Displays matching clinical trial allocations and eligibility information after a selection.
- Supports reset and continuation through the next protocol stage.
- Allows users to jump directly to a step by number, title, prompt, trial name, description, or criteria.
- Supports deep links that open a specific protocol step, including links that preselect an answer.

### Protocol Builder and Content Management

- Create, edit, duplicate, delete, and reorder protocol steps.
- Insert a new stage at a specific position while automatically shifting downstream steps.
- Manage all steps in a full-list administration view as well as the guided screening view.
- Add multiple trial or study options to a protocol stage.
- Store trial names, coordinator contact details, descriptions, and inclusion criteria.
- Add, edit, and remove bullet-point eligibility criteria.
- Attach multiple PDF reference documents to a trial option and open them in an in-app fullscreen viewer.
- Preview a step's title and accent color while editing it.
- Review the complete protocol flow in a read-only overview before publishing or exporting.

### Collaboration and Access Control

- Firebase Authentication with account registration, login, logout, password reset, and friendly error messages.
- Email-verification gating before application data is made available.
- Domain-restricted access for approved HHS team accounts.
- Role-aware access for managers, editors, and viewers.
- View-only behavior for users without edit permissions.
- Live Firestore synchronization so authorized users can work from a shared protocol definition.
- Recent change history and conflict-awareness checks to reduce accidental overwrites.

### Data Protection and Recovery

- Local persistence for continued work between sessions.
- Encrypted browser storage tied to the authenticated user when the encryption utilities are available.
- Local backup rotation with the three most recent saved versions retained.
- Restore a previous local backup without discarding the current version first.
- Import protocol definitions from JSON/TXT files.
- Export protocol definitions for backup, review, sharing, or migration.
- Protocol validation before save, including duplicate step numbers, missing titles/prompts, and invalid branch references.

## Technical Highlights

- Semantic HTML, CSS, and modular vanilla JavaScript; no frontend framework required.
- Firebase Authentication and Cloud Firestore for identity, roles, synchronization, and change history.
- SortableJS for drag-and-drop interactions.
- Responsive dashboard and editor interface for desktop and smaller screens.
- Accessibility-minded controls with labels, focus management, keyboard interaction, and ARIA attributes.
- Modular scripts separated by responsibility: authentication, synchronization, workflow rendering, editing, storage, PDF handling, and sidebar behavior.
- GitHub Actions deployment pipeline that injects Firebase configuration from encrypted repository secrets and publishes the static application to GitHub Pages.

## Running the Project

This is a static web application. Open `index.html` through a local development server or deploy the repository to GitHub Pages.

For cloud-enabled deployments, configure the Firebase values expected by `Scripts/firebase-sync.js` and provide the matching GitHub Actions secrets. The deployment workflow replaces the configuration placeholders during the build and verifies that no placeholders remain before publishing.

## Typical Employer Demonstration Flow

1. Sign in with an approved, verified team account.
2. Run the guided stroke protocol by answering each question.
3. Review matching trial allocations and their eligibility criteria or PDF references.
4. Switch to management mode to review the full protocol structure.
5. Edit or add a stage, attach trial options, validate the flow, and save the update.
6. Demonstrate synchronization, role-based view-only access, history, backup recovery, and protocol export.

## Clinical Use Notice

This application is a protocol organization and workflow-support tool. It is not a substitute for clinician judgment, institutional governance, or current medical guidance. Protocol content must be reviewed and approved by the appropriate clinical and research stakeholders before being used in practice.