import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import projectsRouter from './routes/projects';
import expensesRouter from './routes/expenses';
import materialsRouter from './routes/materials';
import documentsRouter from './routes/documents';
import progressRouter from './routes/progress';

const app = express();

app.use(cors());
// Augmenter la limite pour supporter le téléversement d'images Base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Endpoint racine de santé
app.get('/', (req, res) => {
  res.status(200).json({
    message: "Bienvenue sur l'API de Construction Care",
    version: '1.0.0',
    status: 'online',
  });
});

// Enregistrement des routes
app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/projects', projectsRouter);
app.use('/expenses', expensesRouter);
app.use('/materials', materialsRouter);
app.use('/documents', documentsRouter);
app.use('/progress', progressRouter);

export default app;
