rm -rf ./server/ui/
mkdir -p ./server/ui
cp -R ./ui/build/ ./server/ui/
mv ./server/ui/build/* ./server/ui/
rm -rf ./server/ui/build/