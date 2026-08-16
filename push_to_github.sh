#!/bin/bash
git config --global --unset-all credential.helper
echo "---------------------------------------------------------"
echo "🚀 95X MATKA GITHUB UPLOADER"
echo "---------------------------------------------------------"
echo "Please paste your NEW GitHub Personal Access Token (ghp_...):"
read -s TOKEN
echo "Pushing code to https://github.com/kuldeepydv00/matka.git..."
git push https://kuldeepydv00:${TOKEN}@github.com/kuldeepydv00/matka.git main --force
if [ $? -eq 0 ]; then
    echo "✅ SUCCESS! All backend files uploaded to GitHub!"
else
    echo "❌ Push failed. Please verify your token has 'repo' checked."
fi
