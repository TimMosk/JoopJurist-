export default function handler(req, res) {
  if (req.method === 'POST') {
    res.status(200).send('Hello from API');
  } else {
    res.status(405).send('Method not allowed');
  }
}
